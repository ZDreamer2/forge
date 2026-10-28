import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceTree } from "../../workspace-tree/index.ts";
import { createWorkspaceRoutes } from "../index.ts";

test("identity snapshots repository declarations without collecting or exposing private fields", async () => {
	const repositories = [
		{ path: "nested", status: "missing" as const, secret: "excluded" },
		{ path: ".", status: "available" as const, gitRoot: "/parent", secret: "excluded" },
	];
	const routes = createWorkspaceRoutes({
		root: "/parent/selected",
		name: "Selected",
		repositories,
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
		root,
		name: "Selected",
		repositories: [],
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
