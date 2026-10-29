import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceTree, type TreeEntry } from "../../workspace-tree/index.ts";
import { type AnalysisHandler, AnalysisHandlerError, type AnalysisNode, createTreeAnalyzer } from "../index.ts";

function fixture(entries: Partial<TreeEntry>[] = []) {
	const tree = createWorkspaceTree({ root: "/workspace", codebases: [], repositories: [{ path: "." }] });
	for (const entry of entries)
		tree.insert({
			repo: ".",
			path: "a.md",
			kind: "added",
			current: { kind: "file" },
			statistics: { added: 3, removed: 2, binary: false },
			...entry,
		});
	return tree;
}
function handler(id: string, handler: AnalysisHandler) {
	return { identity: { id }, handler };
}
test("selected predicates are lazy, bounded, current-path based and preserve visible warnings", async () => {
	const tree = fixture([
		{ path: "boundary.md" },
		{ path: "large.MARKDOWN" },
		{ path: "plans/skip.md" },
		{ path: "nested/plans/large.md" },
		{ path: "tests/large.md" },
		{ path: "Tests/a.txt" },
		{ path: "TESTS/a.txt" },
		{ path: "link.md", current: { kind: "symlink" } },
		{ path: "deleted.md", kind: "deleted", current: undefined, base: { kind: "file" } },
		{ path: "pure.md", kind: "renamed", from: "old.md", base: { kind: "file" }, renameContentChanged: false },
		{ path: "edited.md", kind: "renamed", from: "plans/old.md", base: { kind: "file" }, renameContentChanged: true },
		{
			path: "plans/edited.md",
			kind: "renamed",
			from: "outside.md",
			base: { kind: "file" },
			renameContentChanged: true,
		},
		{ path: "binary.md", statistics: { added: 0, removed: 0, binary: true } },
		{ path: "tests-file", current: { kind: "file" } },
	]);
	let pending = 0,
		max = 0;
	const reads: string[] = [];
	const analyzer = createTreeAnalyzer({
		handlers: [
			handler("reset", (root) => {
				for (const node of root.walk())
					if (node.path === "tests/large.md") {
						node.restoreNormalEmphasis();
						node.notice("Restored");
					}
			}),
		],
	});
	const result = await analyzer.analyze(tree, {
		signal: new AbortController().signal,
		currentByteSize: async (node) => {
			reads.push(node.path);
			pending++;
			max = Math.max(max, pending);
			await new Promise((resolve) => setTimeout(resolve, 2));
			pending--;
			return node.path === "boundary.md" ? 20_480 : 20_481;
		},
	});
	assert.equal(max, 2);
	assert.deepEqual(
		reads.sort(),
		["binary.md", "boundary.md", "edited.md", "large.MARKDOWN", "nested/plans/large.md", "tests/large.md"].sort(),
	);
	assert.equal(result.nodes.get("boundary.md")?.node.signals.length, 0);
	assert.equal(result.nodes.get(".")?.signalCounts.warning, 5);
	assert.equal(result.nodes.get("tests")?.signalCounts.warning, 1);
	assert.equal(result.nodes.get("tests/large.md")?.effectiveEmphasis.value, "normal");
	assert.equal(result.nodes.get("tests/large.md")?.node.signals[0]?.handler.id, "builtin:large-markdown");
	assert.equal(result.nodes.get("TESTS")?.effectiveEmphasis.value, "normal");
	assert.equal(result.nodes.get("plans")?.effectiveEmphasis.value, "deemphasized");
});
test("handlers finish sequentially, see direct annotations, cache sizes and annotate foreign owners", async () => {
	const order: string[] = [];
	let reads = 0;
	const analyzer = createTreeAnalyzer({
		handlers: [
			handler("first", async (root) => {
				order.push("first-start");
				root.deemphasize("owner independent");
				await Promise.resolve();
				root.notice("first");
				order.push("first-end");
			}),
			handler("second", async (root) => {
				assert.equal(root.handler.id, "second");
				assert.equal(root.signals[0]?.handler.id, "first");
				root.restoreNormalEmphasis();
				const node = [...root.walk()].find((node) => node.path === "a.md");
				assert.ok(node);
				await root.source.currentByteSize(node);
				await root.source.currentByteSize(node);
				order.push("second");
			}),
		],
	});
	const base = fixture([{}]);
	const run = () =>
		analyzer.analyze(base, {
			signal: new AbortController().signal,
			currentByteSize: async () => {
				reads++;
				return 1;
			},
		});
	const [a, b] = await Promise.all([run(), run()]);
	assert.equal(reads, 2);
	assert.equal(a.nodes.get(".")?.node.signals.length, 1);
	assert.equal(b.nodes.get(".")?.node.signals.length, 1);
	assert.deepEqual(order, ["first-start", "first-start", "first-end", "first-end", "second", "second"]);
	assert.equal("signals" in (base.nodes.get(".") ?? {}), false);
});
test("size/invocation failures identify the handler and reject invalid source requests", async () => {
	const base = fixture([{}]);
	const controller = new AbortController();
	await assert.rejects(
		createTreeAnalyzer({ handlers: [] }).analyze(base, {
			signal: controller.signal,
			currentByteSize: async () => {
				throw new Error("secret path");
			},
		}),
		(error) =>
			error instanceof AnalysisHandlerError &&
			error.handler.id === "builtin:large-markdown" &&
			!error.message.includes("secret"),
	);
	await assert.rejects(
		createTreeAnalyzer({
			handlers: [
				handler("bad", () => {
					throw "private";
				}),
			],
		}).analyze(fixture(), { signal: controller.signal, currentByteSize: async () => 1 }),
		(error) => error instanceof AnalysisHandlerError && error.handler.id === "bad",
	);
	await assert.rejects(
		createTreeAnalyzer({
			handlers: [
				handler("invalid", async (root) => {
					await root.source.currentByteSize(root);
				}),
			],
		}).analyze(fixture(), {
			signal: controller.signal,
			currentByteSize: async () => {
				throw new Error("must not read");
			},
		}),
		(error) => error instanceof AnalysisHandlerError && error.handler.id === "invalid",
	);
});
test("abandon async handler without subsequent stages or late unhandled rejection", async () => {
	let rejectHeld: (reason: unknown) => void = () => {};
	let entered: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let next = false;
	const analyzer = createTreeAnalyzer({
		handlers: [
			handler("held", () => {
				entered();
				return new Promise<void>((_, reject) => {
					rejectHeld = reject;
				});
			}),
			handler("next", () => {
				next = true;
			}),
		],
	});
	const controller = new AbortController();
	const task = analyzer.analyze(fixture(), { signal: controller.signal, currentByteSize: async () => 1 });
	await ready;
	controller.abort(new Error("cancel"));
	await assert.rejects(task, /cancel/);
	rejectHeld(new Error("late"));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(next, false);
});
test("synchronous rules do not yield between nodes", async () => {
	let microtask = false;
	let count = 0;
	let captured: AnalysisNode | undefined;
	const analyzer = createTreeAnalyzer({
		handlers: [
			handler("sync", (root) => {
				queueMicrotask(() => {
					microtask = true;
				});
				for (const node of root.walk()) {
					assert.equal(microtask, false);
					count++;
					captured = node;
				}
			}),
		],
	});
	await analyzer.analyze(fixture([{ path: "x.txt" }, { path: "y.txt" }]), {
		signal: new AbortController().signal,
		currentByteSize: async () => 1,
	});
	assert.equal(count, 3);
	assert.throws(() => captured?.warn("late"), /no longer active/);
});
test("excluded trees perform no size work and codebase context grants whole-tree annotation", async () => {
	const base = fixture([
		{ path: "plans/a.md" },
		{ path: "elsewhere/not-markdown.txt" },
		{ path: "tests/a.txt" },
		{ path: "tests", current: { kind: "directory" }, kind: undefined },
	]);
	const owner = { root: "/workspace/owned", guide: "/guides/owned", type: { id: "service", guide: "/guides/service" } };
	const analyzer = createTreeAnalyzer({
		handlers: [
			{
				identity: { id: "codebase:owned:1", codebase: owner },
				handler: (root) => {
					assert.deepEqual(root.handler.codebase, owner);
					const foreign = [...root.walk()].find((node) => node.path === "elsewhere/not-markdown.txt");
					assert.ok(foreign);
					foreign.emphasize("foreign annotation");
					foreign.warn("owner independent", { side: "current", line: 3, column: 2 });
				},
			},
		],
	});
	const result = await analyzer.analyze(base, {
		signal: new AbortController().signal,
		currentByteSize: async () => {
			assert.fail("excluded candidates must not look up size");
		},
	});
	const foreign = result.nodes.get("elsewhere/not-markdown.txt");
	assert.equal(foreign?.effectiveEmphasis.handler?.codebase?.root, owner.root);
	assert.deepEqual(foreign?.node.signals[0]?.location, { side: "current", line: 3, column: 2 });
	assert.equal(result.nodes.get(".")?.signalCounts.warning, 1);
	const plain = await createTreeAnalyzer({ handlers: [] }).analyze(fixture([{ path: "tests" }]), {
		signal: new AbortController().signal,
		currentByteSize: async () => 1,
	});
	assert.equal(plain.nodes.get("tests")?.effectiveEmphasis.value, "normal");
});
test("late resolution after abort cannot invoke next handler or issue source work", async () => {
	let entered: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let release: () => void = () => {};
	let heldRoot: Parameters<AnalysisHandler>[0] | undefined;
	let later = false;
	let reads = 0;
	const analyzer = createTreeAnalyzer({
		handlers: [
			handler("held", (root) => {
				heldRoot = root;
				entered();
				return new Promise<void>((resolve) => {
					release = resolve;
				});
			}),
			handler("later", () => {
				later = true;
			}),
		],
	});
	const controller = new AbortController();
	const task = analyzer.analyze(fixture([{ path: "a.txt" }]), {
		signal: controller.signal,
		currentByteSize: async () => {
			reads++;
			return 1;
		},
	});
	await ready;
	controller.abort(new Error("abort"));
	await assert.rejects(task, /abort/);
	release();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(later, false);
	assert.throws(() => heldRoot?.source.currentByteSize(heldRoot), /abort/);
	assert.equal(reads, 0);
});
test("source access rejects nodes from another run before calling source", async () => {
	let foreign: AnalysisNode | undefined;
	const first = createTreeAnalyzer({
		handlers: [
			handler("capture", (root) => {
				foreign = [...root.walk()].find((node) => node.path === "a.txt");
			}),
		],
	});
	const tree = fixture([{ path: "a.txt" }]);
	await first.analyze(tree, { signal: new AbortController().signal, currentByteSize: async () => 1 });
	await assert.rejects(
		createTreeAnalyzer({
			handlers: [
				handler("foreign", async (root) => {
					assert.ok(foreign);
					await root.source.currentByteSize(foreign);
				}),
			],
		}).analyze(tree, {
			signal: new AbortController().signal,
			currentByteSize: async () => {
				assert.fail("foreign node must not access source");
			},
		}),
		(error) => error instanceof AnalysisHandlerError && error.handler.id === "foreign",
	);
});
test("concurrent size requests within one handler reuse a single pending observation", async () => {
	let reads = 0;
	const analyzer = createTreeAnalyzer({
		handlers: [
			handler("sizes", async (root) => {
				const node = [...root.walk()].find((node) => node.path === "a.txt");
				assert.ok(node);
				const first = root.source.currentByteSize(node);
				const second = root.source.currentByteSize(node);
				assert.equal(first, second);
				assert.deepEqual(await Promise.all([first, second]), [42, 42]);
			}),
		],
	});
	await analyzer.analyze(fixture([{ path: "a.txt" }]), {
		signal: new AbortController().signal,
		currentByteSize: async () => {
			reads++;
			await Promise.resolve();
			return 42;
		},
	});
	assert.equal(reads, 1);
});
