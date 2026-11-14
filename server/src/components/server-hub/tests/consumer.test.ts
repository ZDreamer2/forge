import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ObservedServer, SelectedHubSource } from "../index.ts";
import { createSelectedHub } from "../index.ts";

const entry: ObservedServer = {
	id: "remote",
	name: "Remote",
	url: "http://127.0.0.1:3210/",
	availability: {
		status: "reachable",
		checkedAt: "2099-01-01T00:00:00.000Z",
		lastReachableAt: "2099-01-01T00:00:00.000Z",
		error: null,
		stale: false,
	},
};

function fixture(source: SelectedHubSource = { status: "selected", url: "http://127.0.0.1:3000/" }) {
	let time = 0;
	const timers = new Map<unknown, { callback: () => void; delay: number }>();
	const calls: { url: string; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
	const hub = createSelectedHub({
		source,
		now: () => time,
		fetch: (input, init) =>
			new Promise<Response>((resolve, reject) => {
				const signal = init?.signal as AbortSignal;
				signal.addEventListener("abort", () => reject(new Error("private transport secret")), { once: true });
				calls.push({ url: String(input), signal, resolve });
			}),
		setTimeout(callback, delay) {
			const handle = {};
			timers.set(handle, { callback, delay });
			return handle;
		},
		clearTimeout(handle) {
			timers.delete(handle);
		},
	});
	return {
		hub,
		calls,
		timers,
		setTime(value: number) {
			time = value;
		},
		async respond(servers: readonly ObservedServer[], index = calls.length - 1) {
			calls[index]?.resolve(Response.json({ servers }));
			await setImmediate();
		},
		refresh() {
			const item = [...timers.entries()].find(([, timer]) => timer.delay === 30_000);
			assert.ok(item);
			timers.delete(item[0]);
			item[1].callback();
		},
	};
}

test("absence and initial unavailable configuration are distinct immediate pure snapshots", async () => {
	const f = fixture({ status: "unconfigured" });
	assert.deepEqual(f.hub.inspect(), {
		source: { status: "unconfigured", url: null },
		servers: null,
		lastSuccessAt: null,
		error: null,
		stale: false,
	});
	f.hub.start();
	assert.equal(f.calls.length, 0);
	await f.hub.replaceSource({ status: "configuration-unavailable", error: "bad\nconfiguration" });
	assert.equal(f.hub.inspect().error, "bad configuration");
	assert.equal(f.hub.inspect().stale, true);
	assert.equal(f.calls.length, 0);
	await f.hub.replaceSource({ status: "configuration-unavailable", error: "new diagnostic" });
	assert.equal(f.hub.inspect().error, "new diagnostic");
	await f.hub.close();
});

test("periodic empty success, failure retention and recovery share one timer", { timeout: 5_000 }, async () => {
	const f = fixture();
	assert.equal(f.hub.inspect().servers, null);
	assert.equal(f.hub.inspect().stale, true);
	f.hub.start();
	assert.equal(f.calls.length, 1);
	await f.respond([]);
	assert.deepEqual(f.hub.inspect().servers, []);
	assert.equal(f.hub.inspect().stale, false);
	assert.equal(f.timers.size, 1);
	f.refresh();
	f.calls[1]?.resolve(new Response("private response secret", { status: 503 }));
	await setImmediate();
	assert.deepEqual(f.hub.inspect().servers, []);
	assert.match(f.hub.inspect().error ?? "", /HTTP 503/);
	assert.equal(f.hub.inspect().lastSuccessAt, "1970-01-01T00:00:00.000Z");
	assert.equal(f.hub.inspect().stale, true);
	f.refresh();
	f.setTime(35_000);
	await f.respond([entry]);
	assert.equal(f.hub.inspect().error, null);
	assert.equal(f.hub.inspect().stale, false);
	await f.hub.close();
	assert.equal(f.timers.size, 0);
});

test("local freshness preserves host staleness and ignores remote clock skew", async () => {
	const f = fixture();
	f.hub.start();
	await f.respond([entry, { ...entry, id: "old", availability: { ...entry.availability, stale: true } }]);
	const snapshot = f.hub.inspect();
	assert.equal(snapshot.servers?.[0]?.availability.stale, false);
	assert.equal(snapshot.servers?.[1]?.availability.stale, true);
	assert.ok(Object.isFrozen(snapshot));
	assert.ok(Object.isFrozen(snapshot.servers));
	assert.ok(Object.isFrozen(snapshot.servers?.[0]?.availability));
	f.setTime(90_001);
	assert.equal(f.hub.inspect().stale, true);
	assert.equal(f.hub.inspect().servers?.[0]?.availability.stale, true);
	assert.equal(snapshot.servers?.[0]?.availability.stale, false);
	f.refresh();
	f.calls[1]?.resolve(new Response("secret", { status: 500 }));
	await setImmediate();
	assert.equal(f.hub.inspect().servers?.[0]?.availability.checkedAt, entry.availability.checkedAt);
	await f.hub.close();
});

test("same source preserves data and in-flight work; changed sources cancel, coalesce and clear synchronously", {
	timeout: 5_000,
}, async () => {
	const f = fixture();
	f.hub.start();
	await f.respond([entry]);
	await f.hub.replaceSource({ status: "selected", url: "http://127.0.0.1:3000/" });
	assert.equal(f.calls.length, 1);
	assert.equal(f.hub.inspect().servers?.length, 1);
	f.refresh();
	await f.hub.replaceSource({ status: "selected", url: "http://127.0.0.1:3000/" });
	assert.equal(f.calls[1]?.signal.aborted, false);
	const replacing = f.hub.replaceSource({ status: "selected", url: "http://127.0.0.1:4000/" });
	assert.equal(f.hub.inspect().servers, null);
	assert.equal(f.calls[1]?.signal.aborted, true);
	const latest = f.hub.replaceSource({ status: "selected", url: "http://127.0.0.1:5000/" });
	await Promise.all([replacing, latest]);
	assert.equal(f.calls.length, 3);
	assert.match(f.calls[2]?.url ?? "", /:5000\//);
	f.calls[1]?.resolve(Response.json({ servers: [entry] }));
	await setImmediate();
	assert.equal(f.hub.inspect().servers, null);
	await f.hub.replaceSource({ status: "unconfigured" });
	assert.equal(f.hub.inspect().source.status, "unconfigured");
	assert.equal(f.hub.inspect().servers, null);
	assert.equal(f.timers.size, 0);
	await f.hub.close();
});

test("close drains cancellation and prevents reload or start resurrecting the consumer", {
	timeout: 5_000,
}, async () => {
	const f = fixture();
	f.hub.start();
	const closing = f.hub.close();
	assert.equal(f.calls[0]?.signal.aborted, true);
	await closing;
	await f.hub.close();
	await f.hub.replaceSource({ status: "selected", url: "http://127.0.0.1:6000/" });
	f.hub.start();
	assert.equal(f.calls.length, 1);
	assert.equal(f.timers.size, 0);
});
