import { Hono } from "hono";
import { createDiagnosticRoutes } from "../components/diagnostic-ui/index.ts";
import { apiError, createWorkspaceRoutes } from "../components/http-api/index.ts";
import type { RepositoryResolution } from "../components/workspace-repositories/index.ts";
import type { WorkspaceTree } from "../components/workspace-tree/index.ts";
import { AccessRejectedError, createRequestGuard } from "../lib/loopback-access/index.ts";

type Deps = {
	root: string;
	name: string;
	repositories: readonly RepositoryResolution[];
	port: number;
	collectChanges: () => Promise<WorkspaceTree>;
	reportError?: (error: Error) => void;
};

export function createHttpApp({ root, name, repositories, port, collectChanges, reportError }: Deps) {
	const app = new Hono();
	app.onError((error, context) => {
		if (error instanceof AccessRejectedError) return context.json(apiError("forbidden"), 403);
		reportError?.(error);
		return context.json(apiError("internal_error"), 500);
	});
	app.use("*", createRequestGuard({ port }));
	app.route("/", createDiagnosticRoutes());
	app.route("/api", createWorkspaceRoutes({ root, name, repositories, collectChanges }));
	app.notFound((context) => context.json(apiError("not_found"), 404));
	return app;
}
