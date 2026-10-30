import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnalysis } from "../analysis.ts";
import { createFileRequests } from "../file-requests.ts";

test("file deadlines include shared waits without cancelling another client", async () => {
	const owner = createFileRequests({ timeoutMs: 20 });
	const shared = Promise.withResolvers<number>();
	const client = new AbortController();
	const first = owner.run(async () => shared.promise, client.signal);
	const second = owner.run(async () => shared.promise);
	client.abort(new Error("disconnected"));
	await assert.rejects(first, /disconnected/);
	shared.resolve(7);
	assert.equal(await second, 7);
	await assert.rejects(
		owner.run(() => new Promise<never>(() => {})),
		/timed out/,
	);
	assert.equal(await owner.run(async () => 8), 8);
	await owner.close();
});

test("disconnect and shutdown drain owned reads before disposal and stop admission", async () => {
	const owner = createFileRequests();
	const held = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	const client = new AbortController();
	const request = owner.run(async (signal, own) => {
		signal.addEventListener("abort", () => aborted.resolve(), { once: true });
		started.resolve();
		return own(held.promise);
	}, client.signal);
	await started.promise;
	client.abort(new Error("disconnected"));
	await aborted.promise;
	let closed = false;
	const closing = owner.close().then(() => {
		closed = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(closed, false);
	const rejected = assert.rejects(request, /disconnected/);
	held.reject(new Error("reader drained"));
	await rejected;
	await closing;
	await assert.rejects(
		owner.run(async () => 1),
		/shutting down/,
	);
});

test("already cancelled requests never start source operations", async () => {
	const owner = createFileRequests();
	const client = new AbortController();
	client.abort(new Error("disconnected"));
	await assert.rejects(
		owner.run(async () => {
			throw new Error("must not run");
		}, client.signal),
		/disconnected/,
	);
	await owner.close();
});

for (const [closingName, createClosing, createOther] of [
	["analysis", createAnalysis, createFileRequests],
	["file requests", createFileRequests, createAnalysis],
] as const) {
	test(`closing ${closingName} only drains its own reads and stops its own admission`, async () => {
		const closingOwner = createClosing();
		const otherOwner = createOther();
		const closingRead = Promise.withResolvers<number>();
		const otherRead = Promise.withResolvers<number>();
		let closingSignal: AbortSignal | undefined;
		let otherSignal: AbortSignal | undefined;
		const closingRequest = closingOwner.run(async (signal, own) => {
			closingSignal = signal;
			return own(closingRead.promise);
		});
		const otherRequest = otherOwner.run(async (signal, own) => {
			otherSignal = signal;
			return own(otherRead.promise);
		});
		await Promise.resolve();
		const rejected = assert.rejects(closingRequest, /shutting down/);
		let closed = false;
		const closing = closingOwner.close().then(() => {
			closed = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(closingSignal?.aborted, true);
		assert.equal(otherSignal?.aborted, false);
		assert.equal(closed, false, "the closing owner still owns its pending source read");
		await assert.rejects(
			closingOwner.run(async () => 1),
			/shutting down/,
		);
		assert.equal(await otherOwner.run(async () => 2), 2);
		closingRead.resolve(3);
		await rejected;
		await closing;
		assert.equal(otherSignal?.aborted, false, "the other owner's read remains active after close finishes");
		otherRead.resolve(4);
		assert.equal(await otherRequest, 4);
		await otherOwner.close();
	});
}
