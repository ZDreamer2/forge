import type {
	AnalysisSide,
	ApiErrorCode,
	ApiFailure,
	WorkspaceAnalysis,
	WorkspaceChanges,
	WorkspaceGuidance,
	WorkspaceIdentity,
} from "../../api-contract/index.ts";
import type { AnalysisResult } from "../../tree-analysis/index.ts";
import type { RepositoryResolution } from "../../workspace-repositories/index.ts";
import type { WorkspaceTree } from "../../workspace-tree/index.ts";
import { codebaseDefinition } from "./codebase-definition.ts";

export function apiError(code: ApiErrorCode, handler?: string): ApiFailure {
	const messages = {
		invalid_request: "Invalid request",
		forbidden: "Request forbidden",
		not_found: "Not found",
		method_not_allowed: "Method not allowed",
		internal_error: "Internal server error",
	};
	return { error: { code, message: messages[code], ...(handler === undefined ? {} : { handler }) } };
}

export function workspaceIdentity(
	root: string,
	name: string,
	repositories: readonly RepositoryResolution[],
): WorkspaceIdentity {
	return {
		workspace: { root, name },
		repositories: repositories.map((repository) =>
			repository.status === "available"
				? { path: repository.path, status: "available", gitRoot: repository.gitRoot }
				: { path: repository.path, status: "missing" },
		),
	};
}

export function workspaceChanges(root: string, tree: WorkspaceTree): WorkspaceChanges {
	const definitions = new Map<string, WorkspaceChanges["codebases"][string]>();
	const changes: WorkspaceChanges["changes"] = [];
	for (const entry of tree.entries) {
		if (entry.kind === undefined) continue;
		const owners = new Set<string>();
		for (const side of [entry.base, entry.current]) {
			const codebase = side?.codebase;
			if (codebase === undefined) continue;
			const { rootKey, definition } = codebaseDefinition(root, codebase);
			owners.add(rootKey);
			definitions.set(rootKey, definition);
		}
		changes.push({
			repo: entry.repo,
			path: entry.path,
			kind: entry.kind,
			...(entry.kind === "renamed" && entry.from !== undefined ? { from: entry.from } : {}),
			codebases: [...owners],
		});
	}
	return { codebases: Object.fromEntries(definitions), changes };
}

export function workspaceAnalysis(
	root: string,
	result: AnalysisResult,
	guidance: WorkspaceGuidance,
): WorkspaceAnalysis {
	const codebases = new Map<string, WorkspaceAnalysis["codebases"][string]>();
	const owner = (codebase: { id: string; root: string; guide: string }): string => {
		const { rootKey, definition } = codebaseDefinition(root, codebase);
		codebases.set(rootKey, definition);
		return rootKey;
	};
	const side = (value: NonNullable<import("../../workspace-tree/index.ts").AnalysisNode["base"]>): AnalysisSide => ({
		path: value.path,
		kind: value.kind,
		...(value.repository === undefined ? {} : { repository: value.repository }),
		...(value.repositoryRoot === undefined ? {} : { repositoryRoot: value.repositoryRoot }),
		...(value.codebase === undefined ? {} : { codebase: owner(value.codebase) }),
		...(value.codebaseRoot === undefined ? {} : { codebaseRoot: owner(value.codebaseRoot) }),
	});
	const handlers = Object.fromEntries(result.handlers.map((handler) => [handler.id, { id: handler.id }]));
	const nodes = Object.fromEntries(
		[...result.nodes].map(([path, finalized]) => {
			const { node, effectiveEmphasis } = finalized;
			return [
				path,
				{
					path,
					classification: {
						value: node.classification.value,
						...(node.classification.reason === undefined ? {} : { reason: node.classification.reason }),
						...(node.classification.handler === undefined ? {} : { handler: node.classification.handler.id }),
					},
					children: node.children.map((child) => child.path),
					...(node.repo === undefined ? {} : { repo: node.repo }),
					...(node.kind === undefined ? {} : { kind: node.kind }),
					...(node.from === undefined ? {} : { from: node.from }),
					...(node.renameContentChanged === undefined ? {} : { renameContentChanged: node.renameContentChanged }),
					...(node.base === undefined ? {} : { base: side(node.base) }),
					...(node.current === undefined ? {} : { current: side(node.current) }),
					...(node.statistics === undefined ? {} : { statistics: { ...node.statistics } }),
					...(node.emphasis === undefined
						? {}
						: {
								emphasis: {
									value: node.emphasis.value,
									reason: node.emphasis.reason,
									handler: node.emphasis.handler.id,
								},
							}),
					signals: node.signals.map((signal) => ({
						severity: signal.severity,
						message: signal.message,
						handler: signal.handler.id,
						...(signal.location === undefined ? {} : { location: { ...signal.location } }),
					})),
					effectiveEmphasis: {
						value: effectiveEmphasis.value,
						...(effectiveEmphasis.reason === undefined ? {} : { reason: effectiveEmphasis.reason }),
						...(effectiveEmphasis.handler === undefined ? {} : { handler: effectiveEmphasis.handler.id }),
						...(effectiveEmphasis.origin === undefined ? {} : { origin: effectiveEmphasis.origin }),
					},
					signalCounts: { ...finalized.signalCounts },
					rawTotals: { ...finalized.rawTotals },
					attentionTotals: { ...finalized.attentionTotals },
				},
			];
		}),
	);
	return { root: result.root, nodes, codebases: Object.fromEntries(codebases), handlers, guidance };
}
