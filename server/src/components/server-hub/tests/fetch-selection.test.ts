import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { fetchSelection } from "../internal/fetch-selection.ts";
import type { ObservedServer, ProbeDependencies } from "../internal/types.ts";

const io: ProbeDependencies = {
	fetch: globalThis.fetch,
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const entry: ObservedServer = {
	id: "server",
	name: "Remote",
	url: "https://example.test/base/",
	availability: { status: "unknown", checkedAt: null, lastReachableAt: null, error: null, stale: true },
};
const signal = () => new AbortController().signal;

async function fixture(
	t: { after(fn: () => Promise<void>): void },
	handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

function mocked(payload: unknown, options: { status?: number; type?: string } = {}): ProbeDependencies {
	return {
		...io,
		fetch: async () =>
			new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
				status: options.status ?? 200,
				headers: { "content-type": options.type ?? "application/json" },
			}),
	};
}

async function rejected(payload: unknown) {
	const result = await fetchSelection("http://127.0.0.1/", signal(), mocked(payload));
	assert.equal(result.servers, null);
	assert.match(result.error ?? "", /incompatible/);
}

test("maximal escaped registrations validate in order with duplicate URLs and ignored extras", async () => {
	const servers = Array.from({ length: 64 }, (_, index) => ({
		...entry,
		id: `${index}${"x".repeat(126)}`,
		name: `x${"\u0000".repeat(255)}`,
		url: `https://example.test/${"a".repeat(2026)}/`,
		extra: "ignored",
		availability: { ...entry.availability, extra: true },
	}));
	assert.equal(Buffer.byteLength(servers[0]?.url ?? ""), 2048);
	const result = await fetchSelection("http://127.0.0.1/", signal(), mocked({ servers, extra: true }));
	assert.equal(result.error, null);
	assert.equal(result.servers?.length, 64);
	assert.deepEqual(
		result.servers?.map((item) => item.id),
		servers.map((item) => item.id),
	);
	assert.ok(Object.isFrozen(result.servers));
	assert.ok(Object.isFrozen(result.servers?.[0]?.availability));
	assert.equal("extra" in (result.servers?.[0] ?? {}), false);
});

test("base paths, no Origin or credentials, and no redirects at the real HTTP seam", { timeout: 5_000 }, async (t) => {
	let redirectFollowed = false;
	const url = await fixture(t, (request, response) => {
		if (request.url === "/destination") redirectFollowed = true;
		assert.equal(request.method, "GET");
		assert.equal(request.headers.origin, undefined);
		assert.equal(request.headers.cookie, undefined);
		assert.equal(request.headers.authorization, undefined);
		if (request.url === "/prefix/api/server-hub/servers") {
			response.writeHead(200, { "content-type": "application/problem+json; charset=utf-8" });
			response.end(JSON.stringify({ servers: [entry] }));
		} else {
			response.writeHead(302, { location: "/destination" });
			response.end("private body secret");
		}
	});
	assert.equal((await fetchSelection(`${url}prefix/`, signal(), io)).servers?.length, 1);
	assert.match((await fetchSelection(url, signal(), io)).error ?? "", /HTTP 302/);
	assert.equal(redirectFollowed, false);
});

test("rejects missing and mistyped registration fields and bounded unique ID/name/URL violations", async () => {
	for (const field of ["id", "name", "url", "availability"]) {
		const item: Record<string, unknown> = { ...entry };
		delete item[field];
		await rejected({ servers: [item] });
		await rejected({ servers: [{ ...entry, [field]: 42 }] });
	}
	for (const id of ["", "bad space", "-bad", "é", "x".repeat(129)]) await rejected({ servers: [{ ...entry, id }] });
	for (const name of ["", "  ", "é".repeat(129)]) await rejected({ servers: [{ ...entry, name }] });
	for (const url of [
		"ftp://example.test/",
		"https://example.test",
		"https://a:b@example.test/",
		"https://@example.test/",
		"https://example.test/?x",
		"https://example.test/#x",
		"https://example.test/\\x/",
		" https://example.test/",
		"https://example.test/a b/",
		`https://example.test/${"a".repeat(2048)}/`,
	])
		await rejected({ servers: [{ ...entry, url }] });
	await rejected({ servers: [entry, entry] });
	await rejected({ servers: Array.from({ length: 65 }, (_, index) => ({ ...entry, id: String(index) })) });
	for (const payload of [null, [], {}, { servers: null }, { servers: [null] }]) await rejected(payload);
});

test("validates all required observation fields and completed-attempt relationships", async () => {
	for (const field of ["status", "checkedAt", "lastReachableAt", "error", "stale"]) {
		const availability: Record<string, unknown> = { ...entry.availability };
		delete availability[field];
		await rejected({ servers: [{ ...entry, availability }] });
		await rejected({ servers: [{ ...entry, availability: { ...entry.availability, [field]: 42 } }] });
	}
	const at = "2026-01-01T00:00:00.000Z";
	for (const availability of [
		{ ...entry.availability, status: "other" },
		{ ...entry.availability, stale: false },
		{ ...entry.availability, checkedAt: at },
		{ ...entry.availability, lastReachableAt: at },
		{ ...entry.availability, error: "bad" },
		{ ...entry.availability, status: "reachable" },
		{ ...entry.availability, status: "reachable", checkedAt: at, lastReachableAt: null },
		{ ...entry.availability, status: "reachable", checkedAt: at, lastReachableAt: at, error: "bad" },
		{ ...entry.availability, status: "unavailable", checkedAt: at, error: null },
		{ ...entry.availability, status: "unavailable", checkedAt: at, error: "" },
		{ ...entry.availability, status: "unavailable", checkedAt: at, error: "x".repeat(321) },
		{
			...entry.availability,
			status: "unavailable",
			checkedAt: at,
			lastReachableAt: "2099-01-01T00:00:00.000Z",
			error: "bad",
		},
		{ ...entry.availability, status: "reachable", checkedAt: "2026-01-01", lastReachableAt: "2026-01-01" },
		{ ...entry.availability, status: "reachable", checkedAt: "bad", lastReachableAt: "bad" },
	])
		await rejected({ servers: [{ ...entry, availability }] });
	for (const availability of [
		{ status: "reachable", checkedAt: at, lastReachableAt: at, error: null, stale: false },
		{ status: "unavailable", checkedAt: at, lastReachableAt: null, error: "Unavailable", stale: false },
		{
			status: "unavailable",
			checkedAt: at,
			lastReachableAt: "2025-01-01T00:00:00.000Z",
			error: "Unavailable",
			stale: true,
		},
	])
		assert.equal(
			(await fetchSelection("http://127.0.0.1/", signal(), mocked({ servers: [{ ...entry, availability }] }))).error,
			null,
		);
});

test("malformed data and transport failures expose fixed diagnostics without remote secrets", async () => {
	for (const deps of [
		mocked("private response secret", { type: "text/plain" }),
		mocked("{private response secret"),
		mocked("private response secret", { status: 503 }),
		{
			...io,
			fetch: async () => {
				throw new Error("private transport secret");
			},
		},
		{
			...io,
			fetch: async () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
		},
	]) {
		const result = await fetchSelection("http://127.0.0.1/", signal(), deps);
		assert.equal(result.servers, null);
		assert.ok(result.error);
		assert.ok(result.error.length <= 320);
		assert.ok(!result.error.includes("private"));
	}
});

test("the decoded-body bound accepts exactly 1 MiB and rejects compressed overflow", { timeout: 5_000 }, async (t) => {
	const json = JSON.stringify({ servers: [] });
	const exact = `${json}${" ".repeat(1024 * 1024 - Buffer.byteLength(json))}`;
	assert.deepEqual((await fetchSelection("http://127.0.0.1/", signal(), mocked(exact))).servers, []);
	assert.match((await fetchSelection("http://127.0.0.1/", signal(), mocked(`${exact} `))).error ?? "", /1 MiB/);
	const url = await fixture(t, (_request, response) => {
		response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
		response.end(gzipSync(`${exact} `));
	});
	assert.match((await fetchSelection(url, signal(), io)).error ?? "", /1 MiB/);
});

for (const phase of ["headers", "body"] as const) {
	for (const mode of ["deadline", "cancel"] as const) {
		test(`${mode} drains a real ${phase} stall and releases its timer`, { timeout: 5_000 }, async (t) => {
			const received = Promise.withResolvers<void>();
			const headers = Promise.withResolvers<void>();
			const url = await fixture(t, (_request, response) => {
				if (phase === "body") {
					response.writeHead(200, { "content-type": "application/json" });
					response.write('{"servers":');
				}
				received.resolve();
			});
			let deadline: (() => void) | undefined;
			let cleared = false;
			const controller = new AbortController();
			const fetching = fetchSelection(url, controller.signal, {
				async fetch(input, init) {
					const response = await fetch(input, init);
					headers.resolve();
					return response;
				},
				setTimeout(callback, delay) {
					assert.equal(delay, 3000);
					deadline = callback;
					return "deadline";
				},
				clearTimeout(handle) {
					assert.equal(handle, "deadline");
					cleared = true;
				},
			});
			await received.promise;
			if (phase === "body") await headers.promise;
			if (mode === "deadline") {
				assert.ok(deadline);
				deadline();
			} else controller.abort();
			assert.match((await fetching).error ?? "", mode === "deadline" ? /3-second deadline/ : /canceled/);
			assert.equal(cleared, true);
		});
	}
}
