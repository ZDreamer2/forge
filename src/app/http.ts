import { Hono } from "hono";
import { apiError, createWorkspaceRoutes } from "../components/workspace-api/index.ts";
import type { CollectedChange } from "../components/workspace-changes/index.ts";
import type { RepositoryResolution } from "../components/workspace-policy/index.ts";
import { AccessRejectedError, createRequestGuard } from "../lib/loopback-access/index.ts";

type Deps = {
	root: string;
	repositories: readonly RepositoryResolution[];
	port: number;
	collectChanges: () => Promise<readonly CollectedChange[]>;
};

export function createHttpApp({ root, repositories, port, collectChanges }: Deps) {
	const app = new Hono();
	app.onError((error, context) =>
		error instanceof AccessRejectedError
			? context.json(apiError("forbidden"), 403)
			: context.json(apiError("internal_error"), 500),
	);
	app.use("*", createRequestGuard({ port }));
	app.route("/api", createWorkspaceRoutes({ root, repositories, collectChanges }));
	app.notFound((context) => context.json(apiError("not_found"), 404));
	return app;
}
