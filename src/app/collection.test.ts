import assert from "node:assert/strict";
import { test } from "node:test";
import { createCollection } from "./collection.ts";

test("overlapping callers share an operation and settlement permits a fresh collection", async () => {
	let calls = 0;
	let finish = Promise.withResolvers<number>();
	const collection = createCollection({
		collect: async () => {
			calls++;
			return finish.promise;
		},
	});
	const first = collection.collect();
	assert.strictEqual(collection.collect(), first);
	await Promise.resolve();
	assert.equal(calls, 1);
	finish.resolve(1);
	assert.equal(await first, 1);
	finish = Promise.withResolvers<number>();
	const second = collection.collect();
	assert.notStrictEqual(second, first);
	finish.resolve(2);
	assert.equal(await second, 2);
	assert.equal(calls, 2);
	await collection.close();
	await assert.rejects(collection.collect(), /shutting down/);
});
