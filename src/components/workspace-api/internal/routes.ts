import { Hono } from "hono";
import type { CollectedChange } from "../../workspace-changes/index.ts";
import type { RepositoryResolution } from "../../workspace-policy/index.ts";
import { apiError, workspaceChanges, workspaceIdentity } from "./wire.ts";

type Deps = {
	root: string;
	repositories: readonly RepositoryResolution[];
	collectChanges: () => Promise<readonly CollectedChange[]>;
};

export function createWorkspaceRoutes({ root, repositories, collectChanges }: Deps) {
	const identity = workspaceIdentity(root, repositories);
	const routes = new Hono();
	routes.get("/workspace", (context) => context.json(identity));
	routes.get("/changes", async (context) => context.json(workspaceChanges(await collectChanges())));
	for (const path of ["/workspace", "/changes"]) {
		routes.all(path, (context) => {
			context.header("Allow", "GET, HEAD");
			return context.json(apiError("method_not_allowed"), 405);
		});
	}
	return routes;
}
