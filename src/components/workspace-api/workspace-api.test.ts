import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceRoutes } from "./index.ts";

test("identity maps declared snapshot in order without serializing policy or extra fields", async () => {
	const repositories = [
		{ path: "nested", status: "missing" as const, secret: "excluded" },
		{ path: ".", status: "available" as const, gitRoot: "/parent", secret: "excluded" },
	];
	const routes = createWorkspaceRoutes({ root: "/parent/selected", repositories });
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
