import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerRegistration } from "../../configuration/index.ts";
import { createServerHub } from "../index.ts";

async function settle() {
	for (let step = 0; step < 40; step++) await Promise.resolve();
}

function clock() {
	let time = Date.parse("2026-01-01T00:00:00.000Z");
	let sequence = 0;
	const timers = new Map<number, { at: number; callback: () => void }>();
	return {
		now: () => time,
		setTime(value: number) {
			time = value;
		},
		setTimeout(callback: () => void, delay: number) {
			const handle = ++sequence;
			timers.set(handle, { at: time + delay, callback });
			return handle;
		},
		clearTimeout(handle: unknown) {
			timers.delete(handle as number);
		},
		get timerCount() {
			return timers.size;
		},
		async advance(milliseconds: number) {
			const until = time + milliseconds;
			while (true) {
				const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > until) break;
				time = next[1].at;
				timers.delete(next[0]);
				next[1].callback();
				await settle();
			}
			time = until;
			await settle();
		},
	};
}

function transport(respectAbort = true) {
	const calls: { url: string; signal: AbortSignal; respond: (response: Response) => void }[] = [];
	const fetch: typeof globalThis.fetch = async (input, options) => {
		const signal = options?.signal;
		assert.ok(signal);
		return new Promise<Response>((resolve, reject) => {
			const abort = () => reject(new Error("aborted"));
			if (respectAbort) signal.addEventListener("abort", abort, { once: true });
			calls.push({
				url: String(input),
				signal,
				respond(response) {
					signal.removeEventListener("abort", abort);
					resolve(response);
				},
			});
		});
	};
	return { calls, fetch };
}

function registration(id = "one", url = `http://127.0.0.1:4311/${id}/`): ServerRegistration {
	return { id, name: id, url };
}

function identity() {
	return Response.json({ workspace: { root: "/private/remote", name: "Remote" }, repositories: [] });
}

test("initial unavailable and valid empty lists stay distinct, with no work before start", {
	timeout: 10_000,
}, async () => {
	const time = clock();
	const io = transport();
	const hub = createServerHub({ servers: null, ...time, fetch: io.fetch });
	assert.equal(hub.inspect(), null);
	hub.start();
	assert.equal(time.timerCount, 0);
	await hub.replaceServers([]);
	assert.deepEqual(hub.inspect(), { servers: [] });
	assert.equal(io.calls.length, 0);
	await hub.replaceServers([registration()]);
	assert.equal(io.calls.length, 1);
	assert.deepEqual(hub.inspect()?.servers[0]?.availability, {
		status: "unknown",
		checkedAt: null,
		lastReachableAt: null,
		error: null,
		stale: true,
	});
	await hub.close();
});

test("observations recover, retain last success, and calculate freshness from completed attempts", {
	timeout: 10_000,
}, async () => {
	const time = clock();
	const io = transport();
	const hub = createServerHub({ servers: [registration()], ...time, fetch: io.fetch });
	const initial = hub.inspect();
	assert.equal(io.calls.length, 0);
	hub.start();
	io.calls[0]?.respond(identity());
	await settle();
	const success = hub.inspect();
	const first = success?.servers[0]?.availability;
	assert.equal(first?.status, "reachable");
	assert.equal(first?.stale, false);
	assert.equal(first?.checkedAt, first?.lastReachableAt);
	assert.equal(initial?.servers[0]?.availability.status, "unknown");
	assert.ok(Object.isFrozen(success) && Object.isFrozen(success?.servers) && Object.isFrozen(first));
	assert.ok(!JSON.stringify(success).includes("/private/remote"));
	const checked = time.now();
	time.setTime(checked + 90_000);
	assert.equal(hub.inspect()?.servers[0]?.availability.stale, false);
	time.setTime(checked + 90_001);
	assert.equal(hub.inspect()?.servers[0]?.availability.stale, true);
	time.setTime(checked);
	await time.advance(30_000);
	io.calls[1]?.respond(new Response("private diagnostic", { status: 503 }));
	await settle();
	const failure = hub.inspect()?.servers[0]?.availability;
	assert.equal(failure?.status, "unavailable");
	assert.equal(failure?.lastReachableAt, first?.lastReachableAt);
	assert.equal(failure?.stale, false);
	assert.ok(!failure?.error?.includes("private"));
	assert.ok((failure?.error?.length ?? 0) <= 320);
	await time.advance(30_000);
	io.calls[2]?.respond(identity());
	await settle();
	assert.equal(hub.inspect()?.servers[0]?.availability.status, "reachable");
	assert.equal(hub.inspect()?.servers[0]?.availability.error, null);
	assert.notEqual(hub.inspect()?.servers[0]?.availability.lastReachableAt, first?.lastReachableAt);
	await hub.close();
});

test("four workers finish one round before its 30-second post-round cadence", { timeout: 10_000 }, async () => {
	const time = clock();
	const io = transport();
	const hub = createServerHub({
		servers: Array.from({ length: 9 }, (_, index) => registration(`server-${index}`)),
		...time,
		fetch: io.fetch,
	});
	hub.start();
	assert.equal(io.calls.length, 4);
	assert.equal(time.timerCount, 4);
	await time.advance(1_000);
	for (const call of io.calls.slice(0, 4)) call.respond(identity());
	await settle();
	assert.equal(io.calls.length, 8);
	assert.equal(time.timerCount, 4);
	await time.advance(1_000);
	for (const call of io.calls.slice(4, 8)) call.respond(identity());
	await settle();
	assert.equal(io.calls.length, 9);
	await time.advance(1_000);
	io.calls[8]?.respond(identity());
	await settle();
	assert.equal(time.timerCount, 1);
	await time.advance(29_999);
	assert.equal(io.calls.length, 9);
	await time.advance(1);
	assert.equal(io.calls.length, 13);
	await hub.close();
	assert.equal(time.timerCount, 0);
	await time.advance(300_000);
	assert.equal(io.calls.length, 13);
});

test("name and order changes preserve target observations and current work", { timeout: 10_000 }, async () => {
	const time = clock();
	const io = transport();
	const first = registration("first");
	const second = registration("second");
	const hub = createServerHub({ servers: [first, second], ...time, fetch: io.fetch });
	hub.start();
	io.calls[0]?.respond(identity());
	await settle();
	await hub.replaceServers([second, { ...first, name: "Renamed" }]);
	assert.equal(io.calls.length, 2);
	assert.equal(io.calls[1]?.signal.aborted, false);
	assert.equal(hub.inspect()?.servers[1]?.availability.status, "reachable");
	assert.equal(hub.inspect()?.servers[1]?.name, "Renamed");
	io.calls[1]?.respond(identity());
	await settle();
	assert.equal(time.timerCount, 1);
	await hub.close();
});

test("rapid replacement drains superseded work and rejects late publication", { timeout: 10_000 }, async () => {
	const time = clock();
	const io = transport(false);
	const hub = createServerHub({ servers: [registration("same"), registration("removed")], ...time, fetch: io.fetch });
	hub.start();
	const firstReplacement = hub.replaceServers([registration("same", "http://127.0.0.1:5000/new/")]);
	const finalReplacement = hub.replaceServers([registration("latest")]);
	assert.equal(io.calls.length, 2);
	assert.ok(io.calls.every((call) => call.signal.aborted));
	assert.equal(hub.inspect()?.servers[0]?.id, "latest");
	for (const call of io.calls.slice(0, 2)) call.respond(identity());
	await Promise.all([firstReplacement, finalReplacement]);
	assert.equal(io.calls.length, 3);
	assert.equal(io.calls[2]?.url, "http://127.0.0.1:4311/latest/api/workspace");
	assert.equal(hub.inspect()?.servers[0]?.availability.status, "unknown");
	const closing = hub.close();
	assert.equal(hub.close(), closing);
	assert.equal(io.calls[2]?.signal.aborted, true);
	io.calls[2]?.respond(identity());
	await closing;
	assert.equal(hub.inspect()?.servers[0]?.availability.status, "unknown");
	assert.equal(time.timerCount, 0);
	await hub.replaceServers([registration("after-close")]);
	hub.start();
	await time.advance(300_000);
	assert.equal(io.calls.length, 3);
});

test("removal cancels in-flight work and leaves no polling timer", { timeout: 10_000 }, async () => {
	const time = clock();
	const io = transport();
	const hub = createServerHub({ servers: [registration()], ...time, fetch: io.fetch });
	hub.start();
	await hub.replaceServers([]);
	assert.deepEqual(hub.inspect(), { servers: [] });
	assert.equal(time.timerCount, 0);
	await time.advance(300_000);
	assert.equal(io.calls.length, 1);
	await hub.close();
});

test("unexpected refresh failures preserve observations and report sanitized diagnostics", {
	timeout: 10_000,
}, async () => {
	const time = clock();
	const io = transport();
	const diagnostics: string[] = [];
	let failClock = false;
	const hub = createServerHub({
		servers: [registration()],
		...time,
		fetch: io.fetch,
		now() {
			if (failClock) {
				failClock = false;
				throw new Error("private operational detail");
			}
			return time.now();
		},
		reportError(message) {
			diagnostics.push(message);
		},
	});
	hub.start();
	io.calls[0]?.respond(identity());
	await settle();
	const prior = hub.inspect();
	await time.advance(30_000);
	failClock = true;
	io.calls[1]?.respond(identity());
	await settle();
	assert.deepEqual(hub.inspect(), prior);
	assert.equal(diagnostics.length, 1);
	assert.ok(!diagnostics[0]?.includes("private"));
	assert.ok((diagnostics[0]?.length ?? 0) <= 320);
	assert.equal(time.timerCount, 1);
	await hub.close();
});
