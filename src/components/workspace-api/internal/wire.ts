import type { CollectedChange } from "../../workspace-changes/index.ts";
import type { RepositoryResolution } from "../../workspace-policy/index.ts";

type WorkspaceIdentity = {
	workspace: { root: string };
	repositories: ({ path: string; status: "available"; gitRoot: string } | { path: string; status: "missing" })[];
};

type ApiErrorCode = "forbidden" | "not_found" | "method_not_allowed" | "internal_error";

type WorkspaceChanges = {
	changes: {
		repo: string;
		path: string;
		kind: "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";
		from?: string;
		binary: boolean;
		addedLines: number | null;
		removedLines: number | null;
		codebases: { id: string; guidance: string }[];
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

export function workspaceIdentity(root: string, repositories: readonly RepositoryResolution[]): WorkspaceIdentity {
	return {
		workspace: { root },
		repositories: repositories.map((repository) =>
			repository.status === "available"
				? { path: repository.path, status: "available", gitRoot: repository.gitRoot }
				: { path: repository.path, status: "missing" },
		),
	};
}

export function workspaceChanges(changes: readonly CollectedChange[]): WorkspaceChanges {
	return {
		changes: changes.map((change) => ({
			repo: change.repo,
			path: change.path,
			kind: change.kind,
			...((change.kind === "renamed" || change.kind === "copied") && change.from !== undefined
				? { from: change.from }
				: {}),
			binary: change.binary,
			addedLines: change.addedLines,
			removedLines: change.removedLines,
			codebases: change.codebases.map((codebase) => ({ id: codebase.id, guidance: codebase.guidance })),
		})),
	};
}
