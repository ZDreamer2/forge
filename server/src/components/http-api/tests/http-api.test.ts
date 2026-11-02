import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceAnalysis } from "../../api-contract/index.ts";
import { createTreeAnalyzer } from "../../tree-analysis/index.ts";
import { createWorkspaceTree } from "../../workspace-tree/index.ts";
import { createWorkspaceRoutes } from "../index.ts";
import { workspaceFileDiff } from "../internal/file-wire.ts";
import { workspaceAnalysis, workspaceChanges } from "../internal/wire.ts";

test("identity snapshots repository declarations without collecting or exposing private fields", async () => {
	const repositories = [
		{ path: "nested", status: "missing" as const, secret: "excluded" },
		{ path: ".", status: "available" as const, gitRoot: "/parent", secret: "excluded" },
	];
	const routes = createWorkspaceRoutes({
		fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		fileDiff: async () => ({ kind: "not_changed" }),
		root: "/parent/selected",
		name: "Selected",
		repositories,
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		collectChanges: async () => {
			throw new Error("Identity must not collect");
		},
	});
	repositories.reverse();
	assert.deepEqual(await (await routes.request("/workspace")).json(), {
		workspace: { root: "/parent/selected", name: "Selected" },
		repositories: [
			{ path: "nested", status: "missing" },
			{ path: ".", status: "available", gitRoot: "/parent" },
		],
	});
});

test("flat projection uses present-side concrete roots, safe keys and response-local definitions", async () => {
	const root = "/selected";
	const codebases = [
		{ id: "client-guide", root: `${root}/client`, guide: `${root}/shared/guidance`, parents: [] },
		{ id: "prototype-guide", root: `${root}/__proto__`, guide: `${root}/shared/guidance`, parents: [] },
	];
	let tree = createWorkspaceTree({ root, repositories: [{ path: "." }], codebases });
	tree.insert({
		repo: ".",
		path: "__proto__/new.bin",
		from: "client/old.bin",
		kind: "renamed",
		base: { kind: "file" },
		current: { kind: "symlink" },
		statistics: { added: 0, removed: 0, binary: true },
	});
	tree.insert({ repo: ".", path: "unmatched.txt", kind: "added", current: { kind: "file" } });
	let collections = 0;
	const routes = createWorkspaceRoutes({
		fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		fileDiff: async () => ({ kind: "not_changed" }),
		root,
		name: "Selected",
		repositories: [],
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		collectChanges: async () => {
			collections++;
			return tree;
		},
	});
	assert.deepEqual(await (await routes.request("/changes")).json(), {
		codebases: {
			client: { id: "client-guide", root: "client", guidance: "shared/guidance" },
			["__proto__"]: { id: "prototype-guide", root: "__proto__", guidance: "shared/guidance" },
		},
		changes: [
			{
				repo: ".",
				path: "__proto__/new.bin",
				kind: "renamed",
				from: "client/old.bin",
				codebases: ["client", "__proto__"],
			},
			{ repo: ".", path: "unmatched.txt", kind: "added", codebases: [] },
		],
	});
	tree = createWorkspaceTree({ root, repositories: [], codebases });
	assert.deepEqual(await (await routes.request("/changes")).json(), { codebases: {}, changes: [] });
	assert.equal(collections, 2);
});

test("analysis emits finalized adjacency, owners, annotations and totals with safe data keys", async () => {
	const root = "/selected";
	const tree = createWorkspaceTree({
		root,
		repositories: [{ path: "." }],
		codebases: [{ id: "prototype-guide", root: `${root}/__proto__`, guide: `${root}/guide`, parents: [] }],
	});
	tree.insert({
		repo: ".",
		path: "__proto__/tests/a.md",
		kind: "added",
		current: { kind: "file" },
		statistics: { added: 4, removed: 2, binary: false },
	});
	const analyzer = createTreeAnalyzer({
		config: {
			workspace: { guide: "/guide", parents: [] },
			guides: [{ id: "prototype-guide", root: `${root}/__proto__`, guide: `${root}/guide`, parents: [] }],
			repositories: [],
			unavailable: [],
		},
		extensions: [
			{
				id: "workspace",
				annotateNode: async ({ node, source }) => {
					if (node.path.endsWith("tests")) node.deemphasize("tests");
					if (node.path.endsWith("a.md")) {
						if ((await source.currentByteSize(node)) > 20480) node.warn("large");
						node.restoreNormalEmphasis();
						node.notice("located", { side: "current", line: 2, column: 1 });
					}
				},
			},
		],
	});
	let calls = 0;
	const routes = createWorkspaceRoutes({
		fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		fileDiff: async () => ({ kind: "not_changed" }),
		root,
		name: "selected",
		repositories: [],
		collectChanges: async () => tree,
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: analyzer.analyze,
		currentByteSize: async () => {
			calls++;
			return 20481;
		},
	});
	const response = await routes.request("/changes/analysis");
	assert.equal(response.status, 200);
	const result = (await response.json()) as WorkspaceAnalysis;
	assert.equal(result.root, ".");
	assert.deepEqual(result.nodes["."]?.children, ["__proto__"]);
	assert.deepEqual(result.nodes["."]?.rawTotals, { added: 4, removed: 2 });
	assert.deepEqual(result.nodes["."]?.attentionTotals, { added: 4, removed: 2 });
	assert.deepEqual(result.nodes["."]?.signalCounts, { notice: 1, warning: 1 });
	assert.equal(result.nodes["__proto__/tests"]?.effectiveEmphasis.value, "deemphasized");
	assert.equal(result.nodes["__proto__/tests/a.md"]?.emphasis?.handler, "workspace#annotateNode");
	assert.equal(result.nodes["__proto__/tests/a.md"]?.signals[1]?.location?.line, 2);
	assert.equal(Object.getOwnPropertyDescriptor(result.codebases, "__proto__")?.value.root, "__proto__");
	assert.deepEqual(result.handlers["workspace#annotateNode"], { id: "workspace#annotateNode" });
	assert.equal(result.codebases.empty, undefined);
	assert.equal(calls, 1);
	assert.equal((await routes.request("/changes/analysis", { method: "HEAD" })).status, 200);
	assert.deepEqual(await (await routes.request("/changes")).json(), {
		codebases: { ["__proto__"]: { id: "prototype-guide", root: "__proto__", guidance: "guide" } },
		changes: [{ repo: ".", path: "__proto__/tests/a.md", kind: "added", codebases: ["__proto__"] }],
	});
	assert.equal(calls, 2);
});

test("file queries decode once, validate context and preserve literal names", async () => {
	const seen: unknown[][] = [];
	const routes = createWorkspaceRoutes({
		root: "/selected",
		name: "Selected",
		repositories: [],
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		collectChanges: async () => createWorkspaceTree({ root: "/selected", repositories: [], codebases: [] }),
		fileDiff: async (_tree, path, signal, context) => {
			assert.ok(signal instanceof AbortSignal);
			seen.push([path, context]);
			return { kind: "not_changed" };
		},
	});
	for (const query of [
		"",
		"path=",
		"path=a&path=b",
		"path=a&ref=HEAD",
		"path=/a",
		"path=a//b",
		"path=a/../b",
		"path=.git/config",
		"path=a%00b",
		"path=C%3A/a",
		"path=a%5Cb",
		"path=a&context=",
		"path=a&context=0",
		"path=a&context=4",
		"path=a&context=ALL",
		"path=a&context=3&context=all",
		"path=a&side=head",
	])
		assert.equal((await routes.request(`/changes/file?${query}`)).status, 400, query);
	assert.deepEqual(seen, []);
	for (const path of ["__proto__", "tab\tnewline\n雪 %2e #?.txt"]) {
		for (const context of [undefined, "3", "all"]) {
			const query = new URLSearchParams({ path, ...(context ? { context } : {}) });
			assert.equal((await routes.request(`/changes/file?${query}`)).status, 200);
			assert.deepEqual(seen.splice(0), [[path, context === "all" ? "all" : 3]]);
		}
	}
	assert.equal((await routes.request("/files/content?path=a&side=current")).status, 404);
	for (const method of ["POST", "OPTIONS", "DELETE"]) {
		const response = await routes.request("/changes/file", { method });
		assert.equal(response.status, 405);
		assert.equal(response.headers.get("allow"), "GET, HEAD");
	}
});

test("all projections keep root keys distinct from stable IDs, including the workspace root", async () => {
	const root = "/selected";
	const workspaceOwner = { id: "workspace-source", root, guide: `${root}/guides/root`, parents: [] };
	const nestedOwner = { id: "nested-source", root: `${root}/nested`, guide: `${root}/guides/nested`, parents: [] };
	const tree = createWorkspaceTree({ root, repositories: [{ path: "." }], codebases: [workspaceOwner, nestedOwner] });
	tree.insert({
		repo: ".",
		path: "nested/new.txt",
		from: "old.txt",
		kind: "renamed",
		base: { kind: "file" },
		current: { kind: "file" },
	});
	const definitions = {
		".": { id: "workspace-source", root: ".", guidance: "guides/root" },
		nested: { id: "nested-source", root: "nested", guidance: "guides/nested" },
	};
	const changes = workspaceChanges(root, tree);
	assert.deepEqual(changes.codebases, definitions);
	assert.deepEqual(changes.changes[0]?.codebases, [".", "nested"]);
	const analyzer = createTreeAnalyzer({
		config: {
			workspace: { guide: "/guide", parents: [] },
			guides: [workspaceOwner, nestedOwner],
			repositories: [],
			unavailable: [],
		},
		extensions: [{ id: "workspace", annotateNode: () => {} }],
	});
	const analysis = workspaceAnalysis(
		root,
		await analyzer.analyze(tree, { currentByteSize: async () => 0, signal: new AbortController().signal }),
	);
	assert.deepEqual(analysis.codebases, definitions);
	assert.equal(analysis.nodes["."]?.current?.codebaseRoot, ".");
	assert.equal(analysis.nodes.nested?.current?.codebaseRoot, "nested");
	assert.equal(analysis.nodes["nested/new.txt"]?.base?.codebase, ".");
	assert.equal(analysis.nodes["nested/new.txt"]?.current?.codebase, "nested");
	assert.deepEqual(analysis.handlers["workspace#annotateNode"], { id: "workspace#annotateNode" });
	const file = workspaceFileDiff(root, {
		kind: "metadata_only",
		path: "nested/new.txt",
		repo: ".",
		baseline: { kind: "unborn" },
		context: 3,
		changeKind: "renamed",
		from: "old.txt",
		statistics: { added: 0, removed: 0, binary: false },
		base: { path: "old.txt", kind: "file", mode: "100644", present: true, codebase: workspaceOwner },
		current: { path: "nested/new.txt", kind: "file", mode: "100644", present: true, codebase: nestedOwner },
	});
	assert.deepEqual(file.codebases, definitions);
	assert.equal(file.kind, "metadata_only");
	if (file.kind !== "metadata_only") throw new Error("Expected metadata-only rename");
	assert.equal(file.base.codebase, ".");
	assert.equal(file.current.codebase, "nested");
});
