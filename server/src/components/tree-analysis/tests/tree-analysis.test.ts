import assert from "node:assert/strict";
import { test } from "node:test";
import type { RootedCodebase, WorkspaceConfig } from "../../workspace-config/index.ts";
import { createWorkspaceTree, type TreeEntry } from "../../workspace-tree/index.ts";
import {
	AnalysisHandlerError,
	type AnalysisNode,
	type AnnotationContribution,
	createTreeAnalyzer,
	type TreeAnnotationContext,
} from "../index.ts";

function config(guides: WorkspaceConfig["guides"] = [], parents: string[] = []): WorkspaceConfig {
	return { workspace: { guide: "/guides/workspace", parents }, guides, repositories: [], unavailable: [] };
}
function owner(id: string, parents: string[] = [], root = `/workspace/${id}`): RootedCodebase {
	return { id, root, guide: `/guides/${id}`, parents };
}
function fixture(entries: Partial<TreeEntry>[] = [], registry = config()) {
	const tree = createWorkspaceTree({
		root: "/workspace",
		codebases: registry.guides.filter((guide): guide is RootedCodebase => guide.root !== undefined),
		repositories: [{ path: "." }],
	});
	for (const entry of entries)
		tree.insert({
			repo: ".",
			path: "a.txt",
			kind: "added",
			current: { kind: "file" },
			statistics: { added: 3, removed: 2, binary: false },
			...entry,
		});
	return tree;
}
function extension(
	annotateNode: NonNullable<AnnotationContribution["annotateNode"]>,
	id: AnnotationContribution["id"] = "workspace",
): AnnotationContribution {
	return { id, annotateNode };
}
const options = () => ({ signal: new AbortController().signal, currentByteSize: async () => 42 });

test("no adopted policies means normal emphasis, no signals or source observations", async () => {
	const result = await createTreeAnalyzer({ config: config(), extensions: [] }).analyze(
		fixture([{ path: "plans/a.md" }, { path: "tests/large.md" }]),
		{ ...options(), currentByteSize: async () => assert.fail("no policy") },
	);
	assert.deepEqual(result.handlers, []);
	assert.equal(result.nodes.get("tests")?.effectiveEmphasis.value, "normal");
	assert.deepEqual(result.nodes.get(".")?.signalCounts, { notice: 0, warning: 0 });
	assert.deepEqual(result.nodes.get(".")?.attentionTotals, result.nodes.get(".")?.rawTotals);
});

test("preorder includes structural, deleted, symlink and transition nodes; hooks finish sequentially", async () => {
	const calls: string[] = [];
	const registry = config([owner("a", ["shared"]), { id: "shared", guide: "/shared", parents: [] }], ["shared"]);
	const extensions = ["codebase:shared", "workspace", "codebase:a"].map((id) =>
		extension(
			async ({ node }) => {
				calls.push(`${node.path}:${id}:start`);
				await Promise.resolve();
				node.notice(id);
				calls.push(`${node.path}:${id}:end`);
			},
			id as AnnotationContribution["id"],
		),
	);
	const tree = fixture(
		[
			{ path: "a/z", kind: "deleted", current: undefined, base: { kind: "file" } },
			{ path: "a/b", current: { kind: "symlink" } },
			{ path: "a/m", current: { kind: "file" }, base: { kind: "directory" } },
			{ path: "a/m/child" },
		],
		registry,
	);
	const result = await createTreeAnalyzer({ config: registry, extensions }).analyze(tree, options());
	assert.deepEqual([...new Set(calls.map((call) => call.split(":")[0]))], [".", "a", "a/b", "a/m", "a/m/child", "a/z"]);
	for (let i = 0; i < calls.length; i += 2) assert.equal(calls[i]?.replace(":start", ":end"), calls[i + 1]);
	assert.deepEqual(
		result.handlers.map((h) => h.id),
		["codebase:shared#annotateNode", "workspace#annotateNode", "codebase:a#annotateNode"],
	);
	assert.deepEqual(
		result.nodes.get("a/z")?.node.signals.map((s) => s.message),
		["codebase:shared", "workspace", "codebase:a"],
	);
	assert.deepEqual(
		result.nodes.get(".")?.node.signals.map((s) => s.message),
		["codebase:shared", "workspace"],
	);
});

test("rename merges independent workspace/base/current ancestries without freezing workspace tie order", async () => {
	const registry = config([
		owner("old", ["a", "b"]),
		owner("new", ["b", "a"]),
		{ id: "a", guide: "/a", parents: [] },
		{ id: "b", guide: "/b", parents: [] },
	]);
	const analyzer = createTreeAnalyzer({ config: registry, extensions: [] });
	await assert.rejects(
		analyzer.analyze(
			fixture([{ path: "new/a", from: "old/a", kind: "renamed", base: { kind: "file" } }], registry),
			options(),
		),
		/annotation node "new\/a".*old.*new/s,
	);
	// Workspace chooses b before otherwise independent a. The base owner's true
	// ancestry a -> b must win; composing workspace+current first would lose it.
	const good = config(
		[
			owner("old", ["a", "b"]),
			owner("new", ["a"]),
			{ id: "a", guide: "/a", parents: [] },
			{ id: "b", guide: "/b", parents: [] },
		],
		["b"],
	);
	const seen: string[] = [];
	const result = await createTreeAnalyzer({
		config: good,
		extensions: good.guides.map((g) =>
			extension(({ node, guide }) => {
				if (node.path === "new/a") seen.push(guide.id);
			}, `codebase:${g.id}`),
		),
	}).analyze(fixture([{ path: "new/a", from: "old/a", kind: "renamed", base: { kind: "file" } }], good), options());
	assert.deepEqual(seen, ["codebase:a", "codebase:b", "codebase:old", "codebase:new"]);
	assert.equal(result.nodes.get("new/a")?.node.base?.codebase?.id, "old");
});

test("rooted parents are invoked through adoption, and unrelated load failures become applicable on refresh", async () => {
	const registry = config([owner("parent"), owner("a", ["parent"]), owner("broken")]);
	const extensions: AnnotationContribution[] = [
		extension(({ node }) => node.notice("parent"), "codebase:parent"),
		{ id: "codebase:broken", error: new Error("secret module") },
	];
	const analyzer = createTreeAnalyzer({ config: registry, extensions });
	const tree = fixture([{ path: "a/file" }, { path: "unassigned/file" }], registry);
	const result = await analyzer.analyze(tree, options());
	assert.deepEqual(result.handlers, [{ id: "codebase:parent#annotateNode" }]);
	assert.equal(result.nodes.get("unassigned/file")?.node.signals.length, 0);
	tree.insert({
		repo: ".",
		path: "a/moved",
		kind: "renamed",
		from: "broken/old",
		base: { kind: "file" },
		current: { kind: "file" },
	});
	await assert.rejects(
		analyzer.analyze(tree, options()),
		(e) =>
			e instanceof AnalysisHandlerError &&
			e.handler.id === "codebase:broken#annotateNode" &&
			!e.message.includes("secret"),
	);
});

test("cross-node effects preserve attribution, inheritance, totals and concurrent request isolation", async () => {
	let reads = 0;
	const registry = config([owner("a")]);
	const analyzer = createTreeAnalyzer({
		config: registry,
		extensions: [
			extension(async ({ node, source }) => {
				if (node.path !== "a/file") return;
				let root = node;
				while (root.parent) root = root.parent;
				root.deemphasize("all");
				root.notice("derived");
				node.restoreNormalEmphasis();
				const first = source.currentByteSize(node);
				assert.equal(first, source.currentByteSize(node));
				await first;
			}, "codebase:a"),
		],
	});
	const tree = fixture([{ path: "a/file" }, { path: "outside" }], registry);
	const run = () =>
		analyzer.analyze(tree, {
			...options(),
			currentByteSize: async () => {
				reads++;
				await Promise.resolve();
				return 1;
			},
		});
	const [a, b] = await Promise.all([run(), run()]);
	assert.equal(reads, 2);
	for (const result of [a, b]) {
		assert.equal(result.nodes.get(".")?.node.signals.length, 1);
		assert.deepEqual(result.nodes.get(".")?.attentionTotals, { added: 3, removed: 2 });
		assert.equal(result.nodes.get(".")?.node.signals[0]?.handler.id, "codebase:a#annotateNode");
	}
	assert.equal("signals" in (tree.nodes.get(".") ?? {}), false);
});

test("source facts cache failures and reject foreign/non-current files", async () => {
	let foreign: AnalysisNode | undefined;
	const tree = fixture([{}]);
	await createTreeAnalyzer({
		config: config(),
		extensions: [
			extension(({ node }) => {
				if (node.path === "a.txt") foreign = node;
			}),
		],
	}).analyze(tree, options());
	let reads = 0;
	await createTreeAnalyzer({
		config: config(),
		extensions: [
			extension(async ({ node, source }) => {
				if (node.path !== "a.txt") return;
				assert.ok(foreign && node.parent);
				await assert.rejects(source.currentByteSize(foreign), /this run/);
				await assert.rejects(source.currentByteSize(node.parent), /regular file/);
				const first = source.currentByteSize(node);
				await assert.rejects(first, /failed observation/);
				assert.equal(first, source.currentByteSize(node));
				await assert.rejects(source.currentByteSize(node), /failed observation/);
			}),
		],
	}).analyze(tree, {
		...options(),
		currentByteSize: async () => {
			reads++;
			throw new Error("failed observation");
		},
	});
	assert.equal(reads, 1);
});

test("adversarial whole-tree fanout cannot exceed two source probes and cancellation stops queued reads", async () => {
	const tree = fixture(Array.from({ length: 6 }, (_, i) => ({ path: `${i}.txt` })));
	const started = Promise.withResolvers<void>();
	const probes = [Promise.withResolvers<number>(), Promise.withResolvers<number>()];
	let context: TreeAnnotationContext | undefined;
	let count = 0;
	const controller = new AbortController();
	const analyzer = createTreeAnalyzer({
		config: config(),
		extensions: [
			extension(async (ctx) => {
				if (ctx.node.path !== ".") return;
				context = ctx;
				await Promise.all(
					[...ctx.node.walk()].filter((n) => n.current?.kind === "file").map((n) => ctx.source.currentByteSize(n)),
				);
			}),
		],
	});
	const run = analyzer.analyze(tree, {
		signal: controller.signal,
		currentByteSize: async () => {
			const index = count++;
			if (count === 2) started.resolve();
			assert.ok(index < 2);
			const probe = probes[index];
			assert.ok(probe);
			return probe.promise;
		},
	});
	await started.promise;
	assert.equal(count, 2);
	controller.abort(new Error("cancel queued"));
	await assert.rejects(run, /cancel queued/);
	probes[0]?.reject(new Error("late rejection"));
	probes[1]?.resolve(1);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(count, 2);
	assert.throws(() => context?.node.warn("late"), /cancel queued/);
	assert.throws(() => context?.source.currentByteSize(context.node), /cancel queued/);
});

test("source bound releases slots after success and all retained capabilities expire after completion", async () => {
	const probes = Array.from({ length: 4 }, () => Promise.withResolvers<number>());
	const firstPair = Promise.withResolvers<void>();
	const secondPair = Promise.withResolvers<void>();
	let count = 0;
	let captured: TreeAnnotationContext | undefined;
	const run = createTreeAnalyzer({
		config: config(),
		extensions: [
			extension(async (ctx) => {
				if (ctx.node.path !== ".") return;
				captured = ctx;
				await Promise.all(
					[...ctx.node.walk()].filter((n) => n.current?.kind === "file").map((n) => ctx.source.currentByteSize(n)),
				);
			}),
		],
	}).analyze(fixture(Array.from({ length: 4 }, (_, i) => ({ path: `${i}.txt` }))), {
		...options(),
		currentByteSize: async () => {
			const index = count++;
			if (count === 2) firstPair.resolve();
			if (count === 4) secondPair.resolve();
			const probe = probes[index];
			assert.ok(probe);
			return probe.promise;
		},
	});
	await firstPair.promise;
	assert.equal(count, 2);
	probes[0]?.resolve(1);
	probes[1]?.resolve(2);
	await secondPair.promise;
	probes[2]?.resolve(3);
	probes[3]?.resolve(4);
	await run;
	assert.throws(() => captured?.node.notice("late"), /no longer active/);
	assert.throws(() => captured?.source.currentByteSize(captured.node), /no longer active/);
});

test("abort races observe late hook rejection and prevent subsequent nodes", async () => {
	const entered = Promise.withResolvers<void>();
	const held = Promise.withResolvers<void>();
	let calls = 0;
	const controller = new AbortController();
	const run = createTreeAnalyzer({
		config: config(),
		extensions: [
			extension(() => {
				calls++;
				entered.resolve();
				return held.promise;
			}),
		],
	}).analyze(fixture([{}]), { ...options(), signal: controller.signal });
	await entered.promise;
	controller.abort(new Error("stop"));
	await assert.rejects(run, /stop/);
	held.reject(new Error("late"));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls, 1);
});
