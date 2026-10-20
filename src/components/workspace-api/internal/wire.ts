import type { RepositoryResolution } from "../../workspace-policy/index.ts";

type WorkspaceIdentity = {
	workspace: { root: string };
	repositories: ({ path: string; status: "available"; gitRoot: string } | { path: string; status: "missing" })[];
};

type ApiErrorCode = "forbidden" | "not_found" | "method_not_allowed" | "internal_error";

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
