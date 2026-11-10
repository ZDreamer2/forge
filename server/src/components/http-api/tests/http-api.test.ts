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
		guidance: { workspace: [], codebases: {} },
		root: "/parent/selected",
		name: "Selected",
		repositories,
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		discoverChanges: async () => ({ kind: "working-changes-discovery" }),
		changesRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		materializeChanges: async () => {
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
		guidance: { workspace: [], codebases: {} },
		name: "Selected",
		repositories: [],
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		discoverChanges: async () => ({ kind: "working-changes-discovery" }),
		changesRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		materializeChanges: async () => {
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
				classifyNode: ({ node, classify }) => {
					if (node.path.endsWith("a.md")) classify("docs", "Markdown");
				},
				annotateNode: async ({ node, source }) => {
					if (node.path === ".") {
						assert.equal(
							[...node.walk()].find((descendant) => descendant.path.endsWith("a.md"))?.classification.value,
							"docs",
						);
					}
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
		guidance: { workspace: [], codebases: {} },
		name: "selected",
		repositories: [],
		discoverChanges: async () => ({ kind: "working-changes-discovery" }),
		changesRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		materializeChanges: async () => tree,
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
	assert.deepEqual(result.nodes["__proto__/tests/a.md"]?.classification, {
		value: "docs",
		reason: "Markdown",
		handler: "workspace#classifyNode",
	});
	for (const path of [".", "__proto__", "__proto__/tests"])
		assert.deepEqual(result.nodes[path]?.classification, { value: "code" }, path);
	assert.deepEqual(Object.keys(result.handlers), ["workspace#classifyNode", "workspace#annotateNode"]);
	assert.deepEqual(result.handlers["workspace#classifyNode"], { id: "workspace#classifyNode" });
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
		guidance: { workspace: [], codebases: {} },
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
		discoverChanges: async () => ({ kind: "working-changes-discovery" }),
		changesRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		materializeChanges: async () => createWorkspaceTree({ root: "/selected", repositories: [], codebases: [] }),
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
		{ workspace: [], codebases: {} },
	);
	assert.deepEqual(analysis.codebases, definitions);
	assert.equal(analysis.nodes["."]?.current?.codebaseRoot, ".");
	assert.equal(analysis.nodes.nested?.current?.codebaseRoot, "nested");
	assert.equal(analysis.nodes["nested/new.txt"]?.base?.codebase, ".");
	assert.equal(analysis.nodes["nested/new.txt"]?.current?.codebase, "nested");
	assert.deepEqual(analysis.handlers["workspace#annotateNode"], { id: "workspace#annotateNode" });
	for (const node of Object.values(analysis.nodes)) assert.deepEqual(node.classification, { value: "code" });
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

test("classification maps one canonical assignment while preserving rename sides, transitions and direct signals", async () => {
	const root = "/selected";
	const owners = [
		{ id: "old-owner", root: `${root}/old`, guide: `${root}/guides/old`, parents: [] },
		{ id: "new-owner", root: `${root}/new`, guide: `${root}/guides/new`, parents: [] },
	];
	const tree = createWorkspaceTree({ root, repositories: [{ path: "." }, { path: "new" }], codebases: owners });
	tree.insert({
		repo: ".",
		path: "new/moved.md",
		from: "old/previous.ts",
		kind: "renamed",
		base: { kind: "file" },
		current: { kind: "file" },
		statistics: { added: 2, removed: 1, binary: false },
	});
	tree.insert({
		repo: ".",
		path: "old/deleted.md",
		kind: "deleted",
		base: { kind: "file" },
		statistics: { added: 0, removed: 3, binary: false },
	});
	tree.insert({
		repo: "new",
		path: "new/tests",
		kind: "modified",
		base: { kind: "file" },
		current: { kind: "directory" },
		statistics: { added: 1, removed: 4, binary: false },
	});
	tree.insert({
		repo: "new",
		path: "new/tests/child.svg",
		kind: "added",
		current: { kind: "symlink" },
		statistics: { added: 5, removed: 0, binary: false },
	});
	const canonicalCalls: string[] = [];
	const analyzer = createTreeAnalyzer({
		config: { workspace: { guide: "/guide", parents: [] }, guides: owners, repositories: [], unavailable: [] },
		extensions: [
			{
				id: "workspace",
				classifyNode: ({ node, classify }) => {
					canonicalCalls.push(node.path);
					if (node.path.endsWith(".md")) classify("docs", "canonical extension");
					if (node.path === "new/tests") classify("tests", "directory transition");
				},
				annotateNode: ({ node }) => {
					if (node.path === "new/tests") node.warn("direct folder warning");
				},
			},
			{
				id: "codebase:new-owner",
				classifyNode: ({ node, classify }) => {
					if (node.path === "new/moved.md") classify("code", "explicit owner override");
				},
			},
		],
	});
	const result = workspaceAnalysis(
		root,
		await analyzer.analyze(tree, { currentByteSize: async () => 0, signal: new AbortController().signal }),
		{ workspace: [], codebases: {} },
	);
	assert.equal(canonicalCalls.length, Object.keys(result.nodes).length);
	assert.equal(new Set(canonicalCalls).size, canonicalCalls.length);
	assert.equal(canonicalCalls.includes("old/previous.ts"), false);
	assert.equal(result.nodes["old/previous.ts"], undefined);
	assert.deepEqual(result.nodes["new/moved.md"]?.classification, {
		value: "code",
		reason: "explicit owner override",
		handler: "codebase:new-owner#classifyNode",
	});
	assert.equal(result.nodes["new/moved.md"]?.base?.codebase, "old");
	assert.equal(result.nodes["new/moved.md"]?.current?.codebase, "new");
	assert.deepEqual(result.nodes["old/deleted.md"]?.classification, {
		value: "docs",
		reason: "canonical extension",
		handler: "workspace#classifyNode",
	});
	assert.equal(result.nodes["old/deleted.md"]?.current, undefined);
	assert.equal(result.nodes.new?.current?.codebaseRoot, "new");
	assert.equal(result.nodes.new?.current?.repositoryRoot, "new");
	assert.deepEqual(result.nodes["new/tests"]?.classification, {
		value: "tests",
		reason: "directory transition",
		handler: "workspace#classifyNode",
	});
	assert.deepEqual(result.nodes["new/tests/child.svg"]?.classification, { value: "code" });
	assert.equal(result.nodes["new/tests/child.svg"]?.current?.kind, "symlink");
	assert.equal(result.nodes["new/tests"]?.signals.length, 1);
	assert.equal(result.nodes["new/tests/child.svg"]?.signals.length, 0);
	assert.deepEqual(result.nodes["new/tests"]?.rawTotals, { added: 6, removed: 4 });
	assert.deepEqual(result.nodes["."]?.rawTotals, { added: 8, removed: 8 });
	assert.deepEqual(result.nodes["."]?.attentionTotals, { added: 8, removed: 8 });
	assert.deepEqual(result.nodes["."]?.signalCounts, { notice: 0, warning: 1 });
	for (const node of Object.values(result.nodes)) {
		if (node.classification.handler) assert.ok(result.handlers[node.classification.handler]);
		assert.equal("origin" in node.classification, false);
	}
	for (const entry of workspaceChanges(root, tree).changes) assert.equal("classification" in entry, false);
});
