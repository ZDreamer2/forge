import type { CollectedWorkspaceChanges } from "../components/workspace-changes/index.ts";
import type { RepositoryResolution } from "../components/workspace-policy/index.ts";

type WorkspaceIdentity = {
	workspace: { root: string; name: string };
	repositories: ({ path: string; status: "available"; gitRoot: string } | { path: string; status: "missing" })[];
};

type ApiErrorCode = "forbidden" | "not_found" | "method_not_allowed" | "internal_error";

type WorkspaceChanges = {
	codebases: Record<string, { guidance: string }>;
	changes: {
		repo: string;
		path: string;
		kind: "added" | "modified" | "deleted" | "renamed";
		from?: string;
		codebases: string[];
	}[];
};

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

export function workspaceChanges(result: CollectedWorkspaceChanges): WorkspaceChanges {
	return {
		codebases: Object.fromEntries(
			Object.entries(result.codebases).map(([id, definition]) => [id, { guidance: definition.guidance }]),
		),
		changes: result.changes.map((change) => ({
			repo: change.repo,
			path: change.path,
			kind: change.kind,
			...(change.kind === "renamed" && change.from !== undefined ? { from: change.from } : {}),
			codebases: [...change.codebases],
		})),
	};
}
