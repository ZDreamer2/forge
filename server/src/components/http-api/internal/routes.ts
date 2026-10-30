import { Hono } from "hono";
import type { AnalysisNode, AnalysisResult } from "../../tree-analysis/index.ts";
import { type createWorkingChanges, SourceForbiddenError } from "../../tree-sources/index.ts";
import type { RepositoryResolution } from "../../workspace-repositories/index.ts";
import type { WorkspaceTree } from "../../workspace-tree/index.ts";
import { parseFileQuery } from "./file-query.ts";
import { workspaceFileDiff } from "./file-wire.ts";
import { apiError, workspaceAnalysis, workspaceChanges, workspaceIdentity } from "./wire.ts";

export type WorkspaceRouteDeps = {
	fileRequests: {
		run: <T>(
			work: (signal: AbortSignal, own: <R>(pending: Promise<R>) => Promise<R>) => Promise<T>,
			signal?: AbortSignal,
		) => Promise<T>;
	};
	fileDiff: ReturnType<typeof createWorkingChanges>["fileDiff"];
	root: string;
	name: string;
	repositories: readonly RepositoryResolution[];
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
	currentByteSize: (
		tree: WorkspaceTree,
		node: import("../../workspace-tree/index.ts").TreeNode,
		signal: AbortSignal,
	) => Promise<number>;
};

export function createWorkspaceRoutes({
	root,
	name,
	repositories,
	collectChanges,
	analysis,
	analyze,
	currentByteSize,
	fileRequests,
	fileDiff,
}: WorkspaceRouteDeps) {
	const identity = workspaceIdentity(root, name, repositories);
	const routes = new Hono();
	routes.get("/workspace", (context) => context.json(identity));
	routes.get("/changes", async (context) => context.json(workspaceChanges(root, await collectChanges())));
	routes.get("/changes/analysis", async (context) => {
		const result = await analysis.run(async (signal, own) => {
			const tree = await collectChanges();
			signal.throwIfAborted();
			return analyze(tree, {
				signal,
				currentByteSize: (node, readSignal) => {
					readSignal.throwIfAborted();
					const entry = tree.nodes.get(node.path);
					if (!entry) return Promise.reject(new Error("Unknown analysis node"));
					return own(currentByteSize(tree, entry, readSignal));
				},
			});
		}, context.req.raw.signal);
		return context.json(workspaceAnalysis(root, result));
	});
	routes.get("/changes/file", async (context) => {
		const query = parseFileQuery(context.req.url);
		if (!query) return context.json(apiError("invalid_request"), 400);
		try {
			const result = await fileRequests.run(async (signal, own) => {
				const tree = await collectChanges();
				signal.throwIfAborted();
				return own(fileDiff(tree, query.path, signal, query.context));
			}, context.req.raw.signal);
			return context.json(workspaceFileDiff(root, result));
		} catch (error) {
			if (error instanceof SourceForbiddenError) return context.json(apiError("forbidden"), 403);
			throw error;
		}
	});
	for (const path of ["/workspace", "/changes", "/changes/analysis", "/changes/file"]) {
		routes.all(path, (context) => {
			context.header("Allow", "GET, HEAD");
			return context.json(apiError("method_not_allowed"), 405);
		});
	}
	return routes;
}
