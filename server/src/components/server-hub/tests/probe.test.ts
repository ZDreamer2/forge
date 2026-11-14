import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { probeWorkspace } from "../internal/probe.ts";
import type { ProbeDependencies } from "../internal/types.ts";

const nativeIO: ProbeDependencies = {
	fetch: globalThis.fetch,
	setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

async function fixture(
	t: { after(fn: () => Promise<void>): void },
	handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
	async function close() {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
	t.after(async () => {
		if (server.listening) await close();
	});
	return { url, close };
}

function target(url: string) {
	return { id: "fixture", name: "Fixture", url };
}

const identity = JSON.stringify({ workspace: { root: "/remote/private", name: "Remote" }, repositories: [] });

test("a real workspace identity uses the configured base path and no Origin or credentials", {
	timeout: 10_000,
}, async (t) => {
	const f = await fixture(t, (request, response) => {
		assert.equal(request.url, "/prefix/api/workspace");
		assert.equal(request.method, "GET");
		assert.equal(request.headers.origin, undefined);
		assert.equal(request.headers.authorization, undefined);
		assert.equal(request.headers.cookie, undefined);
		response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		response.end(identity);
	});
	assert.deepEqual(await probeWorkspace(target(`${f.url}prefix/`), new AbortController().signal, nativeIO), {
		status: "reachable",
		error: null,
	});
});

for (const scenario of [
	{ name: "non-JSON", contentType: "text/html", body: identity, diagnostic: "did not return JSON" },
	{ name: "malformed JSON", contentType: "application/json", body: "{private", diagnostic: "malformed JSON" },
	{
		name: "generic HTTP success",
		contentType: "application/json",
		body: "{}",
		diagnostic: "invalid workspace identity",
	},
	{
		name: "invalid identity fields",
		contentType: "application/json",
		body: '{"workspace":{"root":3,"name":"remote"},"repositories":[]}',
		diagnostic: "invalid workspace identity",
	},
	{
		name: "missing repositories",
		contentType: "application/json",
		body: '{"workspace":{"root":"/private","name":"remote"}}',
		diagnostic: "invalid workspace identity",
	},
]) {
	test(`rejects ${scenario.name} without reflecting remote payloads`, { timeout: 10_000 }, async (t) => {
		const f = await fixture(t, (_request, response) => {
			response.writeHead(200, { "Content-Type": scenario.contentType });
			response.end(scenario.body);
		});
		const result = await probeWorkspace(target(f.url), new AbortController().signal, nativeIO);
		assert.equal(result.status, "unavailable");
		assert.ok(result.error?.includes(scenario.diagnostic));
		assert.ok(!result.error?.includes("private"));
	});
}

test("connection refusal is a bounded sanitized failure", { timeout: 10_000 }, async (t) => {
	const f = await fixture(t, (_request, response) => response.end());
	await f.close();
	const result = await probeWorkspace(target(f.url), new AbortController().signal, nativeIO);
	assert.equal(result.status, "unavailable");
	assert.ok((result.error?.length ?? 0) <= 320);
	assert.ok(!result.error?.includes(f.url));
});

test("redirects are not followed and non-2xx responses cannot establish availability", {
	timeout: 10_000,
}, async (t) => {
	let redirectedRequests = 0;
	const f = await fixture(t, (request, response) => {
		if (request.url === "/destination") redirectedRequests++;
		response.writeHead(302, { Location: "/destination", "Content-Type": "application/json" });
		response.end(identity);
	});
	const result = await probeWorkspace(target(f.url), new AbortController().signal, nativeIO);
	assert.equal(result.status, "unavailable");
	assert.match(result.error ?? "", /HTTP 302/);
	assert.equal(redirectedRequests, 0);
	const denied = await fixture(t, (_request, response) => {
		response.writeHead(503, { "Content-Type": "application/json" });
		response.end(identity);
	});
	assert.equal(
		(await probeWorkspace(target(denied.url), new AbortController().signal, nativeIO)).status,
		"unavailable",
	);
});

test("the 64-KiB bound accepts its exact edge and rejects streamed decoded overflow", {
	timeout: 10_000,
}, async (t) => {
	const exact = `${identity}${" ".repeat(64 * 1024 - Buffer.byteLength(identity))}`;
	const edge = await fixture(t, (_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(exact);
	});
	assert.equal((await probeWorkspace(target(edge.url), new AbortController().signal, nativeIO)).status, "reachable");
	const streamed = await fixture(t, (_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.write(exact.slice(0, 32 * 1024));
		response.write(exact.slice(32 * 1024));
		response.end(" ");
	});
	const overflow = await probeWorkspace(target(streamed.url), new AbortController().signal, nativeIO);
	assert.equal(overflow.status, "unavailable");
	assert.match(overflow.error ?? "", /exceeded 64 KiB/);
	const compressed = await fixture(t, (_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
		response.end(gzipSync(`${exact} `));
	});
	assert.match(
		(await probeWorkspace(target(compressed.url), new AbortController().signal, nativeIO)).error ?? "",
		/exceeded 64 KiB/,
	);
});

for (const phase of ["headers", "body"] as const) {
	test(`the one total deadline cancels a ${phase} stall and releases its timer`, { timeout: 10_000 }, async (t) => {
		const received = Promise.withResolvers<void>();
		const headersReceived = Promise.withResolvers<void>();
		const f = await fixture(t, (_request, response) => {
			if (phase === "body") {
				response.writeHead(200, { "Content-Type": "application/json" });
				response.write('{"workspace":');
			}
			received.resolve();
		});
		let deadline: (() => void) | undefined;
		let cleared = false;
		let scheduled = 0;
		const probing = probeWorkspace(target(f.url), new AbortController().signal, {
			async fetch(input, options) {
				const response = await globalThis.fetch(input, options);
				headersReceived.resolve();
				return response;
			},
			setTimeout(callback, milliseconds) {
				assert.equal(milliseconds, 3_000);
				deadline = callback;
				scheduled++;
				return "deadline";
			},
			clearTimeout(handle) {
				assert.equal(handle, "deadline");
				cleared = true;
			},
		});
		await received.promise;
		if (phase === "body") await headersReceived.promise;
		assert.ok(deadline);
		deadline();
		assert.match((await probing).error ?? "", /3-second deadline/);
		assert.equal(scheduled, 1);
		assert.equal(cleared, true);
	});
}

test("shutdown cancellation settles a stalled decoded body", { timeout: 10_000 }, async (t) => {
	const headersReceived = Promise.withResolvers<void>();
	const f = await fixture(t, (_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.write('{"workspace":');
	});
	const controller = new AbortController();
	const probing = probeWorkspace(target(f.url), controller.signal, {
		...nativeIO,
		async fetch(input, options) {
			const response = await globalThis.fetch(input, options);
			headersReceived.resolve();
			return response;
		},
	});
	await headersReceived.promise;
	controller.abort();
	assert.match((await probing).error ?? "", /canceled/);
});
