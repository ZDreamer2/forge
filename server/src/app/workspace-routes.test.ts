import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceRoutes } from "./workspace-routes.ts";

test("identity maps declared snapshot in order without serializing policy or extra fields", async () => {
	const repositories = [
		{ path: "nested", status: "missing" as const, secret: "excluded" },
		{ path: ".", status: "available" as const, gitRoot: "/parent", secret: "excluded" },
	];
	const routes = createWorkspaceRoutes({
		root: "/parent/selected",
		name: "Selected",
		repositories,
		collectChanges: async () => {
			throw new Error("Identity must not collect changes");
		},
	});
	repositories.reverse();
	const response = await routes.request("/workspace");
	assert.deepEqual(await response.json(), {
		workspace: { root: "/parent/selected", name: "Selected" },
		repositories: [
			{ path: "nested", status: "missing" },
			{ path: ".", status: "available", gitRoot: "/parent" },
		],
	});
});

test("changes serialize one safe definition index, ID references and only the reduced wire fields", async () => {
	let collections = 0;
	const result = {
		codebases: {
			client: { guidance: "shared/guidance", private: "excluded" },
			["__proto__"]: { guidance: "shared/guidance", private: "excluded" },
		},
		changes: [
			{
				repo: ".",
				path: "mode.txt",
				kind: "modified" as const,
				from: "must-not-leak",
				codebases: ["client", "__proto__"],
				private: "excluded",
			},
			{
				repo: "nested",
				path: "nested/new.bin",
				kind: "renamed" as const,
				from: "nested/old.bin",
				codebases: ["client"],
			},
		],
	};
	const routes = createWorkspaceRoutes({
		root: "/selected",
		name: "Selected",
		repositories: [],
		collectChanges: async () => {
			collections++;
			return result;
		},
	});
	const response = await routes.request("/changes");
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		codebases: { client: { guidance: "shared/guidance" }, ["__proto__"]: { guidance: "shared/guidance" } },
		changes: [
			{ repo: ".", path: "mode.txt", kind: "modified", codebases: ["client", "__proto__"] },
			{
				repo: "nested",
				path: "nested/new.bin",
				kind: "renamed",
				from: "nested/old.bin",
				codebases: ["client"],
			},
		],
	});
	assert.equal(collections, 1);
	result.changes.splice(0);
	for (const id of Object.keys(result.codebases)) delete result.codebases[id as keyof typeof result.codebases];
	assert.deepEqual(await (await routes.request("/changes")).json(), { codebases: {}, changes: [] });
	assert.equal(collections, 2);
});
