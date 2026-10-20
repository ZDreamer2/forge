import { Hono } from "hono";
import type { RepositoryResolution } from "../../workspace-policy/index.ts";
import { apiError, workspaceIdentity } from "./wire.ts";

type Deps = { root: string; repositories: readonly RepositoryResolution[] };

export function createWorkspaceRoutes({ root, repositories }: Deps) {
	const identity = workspaceIdentity(root, repositories);
	const routes = new Hono();
	routes.get("/workspace", (context) => context.json(identity));
	routes.all("/workspace", (context) => {
		context.header("Allow", "GET, HEAD");
		return context.json(apiError("method_not_allowed"), 405);
	});
	return routes;
}
