import { Hono } from "hono";
import { createDiagnosticRoutes } from "../components/diagnostic-ui/index.ts";
import { apiError, createWorkspaceRoutes } from "../components/http-api/index.ts";
import { AnalysisHandlerError } from "../components/tree-analysis/index.ts";
import { AccessRejectedError, createRequestGuard } from "../lib/loopback-access/index.ts";

type Deps = import("../components/http-api/index.ts").WorkspaceRouteDeps & {
	port: number;
	reportError?: (error: Error) => void;
};

export function createHttpApp({
	root,
	name,
	repositories,
	port,
	collectChanges,
	analysis,
	analyze,
	currentByteSize,
	fileRequests,
	fileDiff,
	reportError,
}: Deps) {
	const app = new Hono();
	app.onError((error, context) => {
		if (error instanceof AccessRejectedError) return context.json(apiError("forbidden"), 403);
		reportError?.(error);
		return context.json(
			apiError("internal_error", error instanceof AnalysisHandlerError ? error.handler.id : undefined),
			500,
		);
	});
	app.use("*", createRequestGuard({ port }));
	app.route("/", createDiagnosticRoutes());
	app.route(
		"/api",
		createWorkspaceRoutes({
			root,
			name,
			repositories,
			collectChanges,
			analysis,
			analyze,
			currentByteSize,
			fileRequests,
			fileDiff,
		}),
	);
	app.notFound((context) => context.json(apiError("not_found"), 404));
	return app;
}
