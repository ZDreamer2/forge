import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceRoutes } from "./index.ts";

test("identity maps declared snapshot in order without serializing policy or extra fields", async () => {
	const repositories = [
		{ path: "nested", status: "missing" as const, secret: "excluded" },
		{ path: ".", status: "available" as const, gitRoot: "/parent", secret: "excluded" },
	];
	const routes = createWorkspaceRoutes({
		root: "/parent/selected",
		repositories,
		collectChanges: async () => {
			throw new Error("Identity must not collect changes");
		},
	});
	repositories.reverse();
	const response = await routes.request("/workspace");
	assert.deepEqual(await response.json(), {
		workspace: { root: "/parent/selected" },
		repositories: [
			{ path: "nested", status: "missing" },
			{ path: ".", status: "available", gitRoot: "/parent" },
		],
	});
});

test("changes map only wire fields, preserving metadata, binary counts and conditional previous paths", async () => {
	let collections = 0;
	const changes = [
		{
			repo: ".",
			path: "mode.txt",
			kind: "modified" as const,
			from: "must-not-leak",
			binary: false,
			addedLines: 0,
			removedLines: 0,
			codebases: [{ id: "client", guidance: "shared/guidance", private: "excluded" }],
			private: "excluded",
		},
		{
			repo: "nested",
			path: "nested/new.bin",
			kind: "renamed" as const,
			from: "nested/old.bin",
			binary: true,
			addedLines: null,
			removedLines: null,
			codebases: [],
		},
		{
			repo: ".",
			path: "copy.txt",
			kind: "copied" as const,
			from: "original.txt",
			binary: false,
			addedLines: 0,
			removedLines: 0,
			codebases: [],
		},
	];
	const routes = createWorkspaceRoutes({
		root: "/selected",
		repositories: [],
		collectChanges: async () => {
			collections++;
			return changes;
		},
	});
	const response = await routes.request("/changes");
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		changes: [
			{
				repo: ".",
				path: "mode.txt",
				kind: "modified",
				binary: false,
				addedLines: 0,
				removedLines: 0,
				codebases: [{ id: "client", guidance: "shared/guidance" }],
			},
			{
				repo: "nested",
				path: "nested/new.bin",
				kind: "renamed",
				from: "nested/old.bin",
				binary: true,
				addedLines: null,
				removedLines: null,
				codebases: [],
			},
			{
				repo: ".",
				path: "copy.txt",
				kind: "copied",
				from: "original.txt",
				binary: false,
				addedLines: 0,
				removedLines: 0,
				codebases: [],
			},
		],
	});
	assert.equal(collections, 1);
	changes.splice(0);
	assert.deepEqual(await (await routes.request("/changes")).json(), { changes: [] });
	assert.equal(collections, 2);
});
