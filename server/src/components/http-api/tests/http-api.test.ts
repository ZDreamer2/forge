import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceAnalysis } from "../../api-contract/index.ts";
import { createTreeAnalyzer } from "../../tree-analysis/index.ts";
import { createWorkspaceTree } from "../../workspace-tree/index.ts";
import { createWorkspaceRoutes } from "../index.ts";

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
		analyze: createTreeAnalyzer({ handlers: [] }).analyze,
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
		{ root: `${root}/client`, guide: `${root}/shared/guidance`, type: { id: "service", guide: "/types" } },
		{ root: `${root}/__proto__`, guide: `${root}/shared/guidance` },
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
		analyze: createTreeAnalyzer({ handlers: [] }).analyze,
		currentByteSize: async () => 0,
		collectChanges: async () => {
			collections++;
			return tree;
		},
	});
	assert.deepEqual(await (await routes.request("/changes")).json(), {
		codebases: {
			client: { root: "client", guidance: "shared/guidance", type: "service" },
			["__proto__"]: { root: "__proto__", guidance: "shared/guidance" },
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
		codebases: [{ root: `${root}/__proto__`, guide: `${root}/guide` }],
	});
	tree.insert({
		repo: ".",
		path: "__proto__/tests/a.md",
		kind: "added",
		current: { kind: "file" },
		statistics: { added: 4, removed: 2, binary: false },
	});
	const analyzer = createTreeAnalyzer({
		handlers: [
			{
				identity: { id: "workspace:1", codebase: { root: `${root}/empty`, guide: `${root}/external-guide` } },
				handler: (root) => {
					for (const node of root.walk())
						if (node.path.endsWith("a.md")) {
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
	assert.equal(result.nodes["__proto__/tests/a.md"]?.emphasis?.handler, "workspace:1");
	assert.equal(result.nodes["__proto__/tests/a.md"]?.signals[1]?.location?.line, 2);
	assert.equal(Object.getOwnPropertyDescriptor(result.codebases, "__proto__")?.value.root, "__proto__");
	assert.equal(result.handlers["workspace:1"]?.codebase, "empty");
	assert.equal(result.codebases.empty?.root, "empty");
	assert.equal(calls, 1);
	assert.equal((await routes.request("/changes/analysis", { method: "HEAD" })).status, 200);
	assert.deepEqual(await (await routes.request("/changes")).json(), {
		codebases: { ["__proto__"]: { root: "__proto__", guidance: "guide" } },
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
		analyze: createTreeAnalyzer({ handlers: [] }).analyze,
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
