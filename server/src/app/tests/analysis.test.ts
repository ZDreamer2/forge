import assert from "node:assert/strict";
import { test } from "node:test";
import { createTreeAnalyzer } from "../../components/tree-analysis/index.ts";
import { createWorkspaceTree } from "../../components/workspace-tree/index.ts";
import { createAnalysis } from "../analysis.ts";
import { createHttpApp } from "../http.ts";

// Held promises make cancellation deterministic without waiting on handler cooperation.
test("analysis requests have independent signals and cancellation never cancels shared work", async () => {
	const owner = createAnalysis();
	const shared = Promise.withResolvers<number>();
	const client = new AbortController();
	let firstSignal: AbortSignal | undefined;
	let secondSignal: AbortSignal | undefined;
	const first = owner.run(async (signal) => {
		firstSignal = signal;
		await shared.promise;
		signal.throwIfAborted();
		throw new Error("Cancelled work continued");
	}, client.signal);
	const second = owner.run(async (signal) => {
		secondSignal = signal;
		return shared.promise;
	});
	await Promise.resolve();
	assert.notStrictEqual(firstSignal, secondSignal);
	client.abort(new Error("client left"));
	await assert.rejects(first, /client left/);
	assert.equal(secondSignal?.aborted, false);
	shared.resolve(42);
	assert.equal(await second, 42);
	await owner.close();
});

test("the operation budget includes waiting, and late rejection is observed", async () => {
	const owner = createAnalysis({ timeoutMs: 5 });
	const held = Promise.withResolvers<void>();
	const run = owner.run(() => held.promise);
	await assert.rejects(run, /timed out/);
	held.reject(new Error("late failure"));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(await owner.run(async () => 7), 7);
	await owner.close();
});

test("shutdown stops admission and joins owned waits around never-settling handlers", async () => {
	const owner = createAnalysis();
	let signal: AbortSignal | undefined;
	const run = owner.run(async (value) => {
		signal = value;
		return new Promise<never>(() => {});
	});
	await Promise.resolve();
	const rejected = assert.rejects(run, /shutting down/);
	await owner.close();
	await rejected;
	assert.equal(signal?.aborted, true);
	await assert.rejects(
		owner.run(async () => 1),
		/shutting down/,
	);
});

test("an already disconnected client cannot start work", async () => {
	const owner = createAnalysis();
	const client = new AbortController();
	client.abort(new Error("disconnected"));
	let called = false;
	await assert.rejects(
		owner.run(async () => {
			called = true;
		}, client.signal),
		/disconnected/,
	);
	assert.equal(called, false);
	await owner.close();
});

test("a failed size candidate aborts and drains the other probe before releasing its request owner", async () => {
	const owner = createAnalysis();
	const tree = createWorkspaceTree({ root: "/selected", repositories: [{ path: "." }], codebases: [] });
	for (const path of ["a.md", "b.md", "c.md"])
		tree.insert({ repo: ".", path, kind: "added", current: { kind: "file" } });
	const failure = Promise.withResolvers<number>();
	const held = Promise.withResolvers<number>();
	const started = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	const reads: string[] = [];
	let laterHandler = false;
	const analyzer = createTreeAnalyzer({
		handlers: [
			{
				identity: { id: "workspace:1" },
				handler: () => {
					laterHandler = true;
				},
			},
		],
	});
	const app = createHttpApp({
		root: "/selected",
		name: "Selected",
		repositories: [],
		port: 43210,
		analysis: owner,
		collectChanges: async () => tree,
		analyze: analyzer.analyze,
		currentByteSize: async (_tree, node, signal) => {
			reads.push(node.path);
			if (node.path === "a.md") return failure.promise;
			signal.addEventListener("abort", () => aborted.resolve(), { once: true });
			started.resolve();
			return held.promise;
		},
	});
	let requestSettled = false;
	const request = Promise.resolve(app.request("/api/changes/analysis", { headers: { host: "127.0.0.1:43210" } })).then(
		(response) => {
			requestSettled = true;
			return response;
		},
	);
	await started.promise;
	failure.reject(new Error("first leaf disappeared"));
	await aborted.promise;
	let closed = false;
	const closing = owner.close().then(() => {
		closed = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(requestSettled, false, "failed request still owns the cancelling source probe");
	assert.equal(closed, false, "shutdown must join probe cleanup");
	held.reject(new Error("probe reaped"));
	assert.equal((await request).status, 500);
	await closing;
	assert.deepEqual(reads, ["a.md", "b.md"]);
	assert.equal(laterHandler, false);
});

test("shutdown keeps a cancelled analysis registered until its source probe is reaped", async () => {
	const owner = createAnalysis();
	const tree = createWorkspaceTree({ root: "/selected", repositories: [{ path: "." }], codebases: [] });
	tree.insert({ repo: ".", path: "a.md", kind: "added", current: { kind: "file" } });
	const probe = Promise.withResolvers<number>();
	const started = Promise.withResolvers<void>();
	const aborted = Promise.withResolvers<void>();
	let laterHandler = false;
	const analyzer = createTreeAnalyzer({
		handlers: [
			{
				identity: { id: "workspace:1" },
				handler: () => {
					laterHandler = true;
				},
			},
		],
	});
	const app = createHttpApp({
		root: "/selected",
		name: "Selected",
		repositories: [],
		port: 43210,
		analysis: owner,
		collectChanges: async () => tree,
		analyze: analyzer.analyze,
		currentByteSize: async (_tree, _node, signal) => {
			signal.addEventListener("abort", () => aborted.resolve(), { once: true });
			started.resolve();
			return probe.promise;
		},
	});
	const request = app.request("/api/changes/analysis", { headers: { host: "127.0.0.1:43210" } });
	await started.promise;
	let closed = false;
	const closing = owner.close().then(() => {
		closed = true;
	});
	await aborted.promise;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(closed, false);
	probe.reject(new Error("cancelled probe reaped"));
	await closing;
	assert.equal((await request).status, 500);
	assert.equal(laterHandler, false);
});
