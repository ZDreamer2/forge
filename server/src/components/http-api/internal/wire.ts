import { relative, sep } from "node:path";
import type { ApiErrorCode, WorkspaceChanges, WorkspaceIdentity } from "../../api-contract/index.ts";
import type { RepositoryResolution } from "../../workspace-repositories/index.ts";
import type { WorkspaceTree } from "../../workspace-tree/index.ts";

export function apiError(code: ApiErrorCode) {
	const messages = {
		forbidden: "Request forbidden",
		not_found: "Not found",
		method_not_allowed: "Method not allowed",
		internal_error: "Internal server error",
	};
	return { error: { code, message: messages[code] } };
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
	const workspacePath = (path: string) => relative(root, path).split(sep).join("/") || ".";
	for (const entry of tree.entries) {
		if (entry.kind === undefined) continue;
		const owners = new Set<string>();
		for (const side of [entry.base, entry.current]) {
			const codebase = side?.codebase;
			if (codebase === undefined) continue;
			const id = workspacePath(codebase.root);
			owners.add(id);
			definitions.set(id, {
				root: id,
				guidance: workspacePath(codebase.guide),
				...(codebase.type ? { type: codebase.type.id } : {}),
			});
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
