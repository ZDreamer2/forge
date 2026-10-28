import { Hono } from "hono";
import type { RepositoryResolution } from "../../workspace-repositories/index.ts";
import type { WorkspaceTree } from "../../workspace-tree/index.ts";
import { apiError, workspaceChanges, workspaceIdentity } from "./wire.ts";

type Deps = {
	root: string;
	name: string;
	repositories: readonly RepositoryResolution[];
	collectChanges: () => Promise<WorkspaceTree>;
};

export function createWorkspaceRoutes({ root, name, repositories, collectChanges }: Deps) {
	const identity = workspaceIdentity(root, name, repositories);
	const routes = new Hono();
	routes.get("/workspace", (context) => context.json(identity));
	routes.get("/changes", async (context) => context.json(workspaceChanges(root, await collectChanges())));
	for (const path of ["/workspace", "/changes"]) {
		routes.all(path, (context) => {
			context.header("Allow", "GET, HEAD");
			return context.json(apiError("method_not_allowed"), 405);
		});
	}
	return routes;
}
