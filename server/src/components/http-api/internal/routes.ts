import { Hono } from "hono";
import type { AnalysisNode, AnalysisResult } from "../../tree-analysis/index.ts";
import type { RepositoryResolution } from "../../workspace-repositories/index.ts";
import type { WorkspaceTree } from "../../workspace-tree/index.ts";
import { apiError, workspaceAnalysis, workspaceChanges, workspaceIdentity } from "./wire.ts";

type Deps = {
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
}: Deps) {
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
	for (const path of ["/workspace", "/changes", "/changes/analysis"]) {
		routes.all(path, (context) => {
			context.header("Allow", "GET, HEAD");
			return context.json(apiError("method_not_allowed"), 405);
		});
	}
	return routes;
}
