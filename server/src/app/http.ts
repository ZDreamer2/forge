import { Hono } from "hono";
import { createDiagnosticRoutes } from "../components/diagnostic-ui/index.ts";
import { apiError, createWorkspaceRoutes } from "../components/http-api/index.ts";
import { AnalysisHandlerError, type AnalysisNode, type AnalysisResult } from "../components/tree-analysis/index.ts";
import type { RepositoryResolution } from "../components/workspace-repositories/index.ts";
import type { TreeNode, WorkspaceTree } from "../components/workspace-tree/index.ts";
import { AccessRejectedError, createRequestGuard } from "../lib/loopback-access/index.ts";

type Deps = {
	root: string;
	name: string;
	repositories: readonly RepositoryResolution[];
	port: number;
	collectChanges: () => Promise<WorkspaceTree>;
	analysis: {
		run: <T>(
			work: (signal: AbortSignal, own: <R>(pending: Promise<R>) => Promise<R>) => Promise<T>,
			signal?: AbortSignal,
		) => Promise<T>;
	};
	analyze: (
		tree: WorkspaceTree,
		options: { signal: AbortSignal; currentByteSize: (node: AnalysisNode, signal: AbortSignal) => Promise<number> },
	) => Promise<AnalysisResult>;
	currentByteSize: (tree: WorkspaceTree, node: TreeNode, signal: AbortSignal) => Promise<number>;
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
		createWorkspaceRoutes({ root, name, repositories, collectChanges, analysis, analyze, currentByteSize }),
	);
	app.notFound((context) => context.json(apiError("not_found"), 404));
	return app;
}
