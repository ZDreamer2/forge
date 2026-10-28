export type WorkspaceIdentity = {
	workspace: { root: string; name: string };
	repositories: ({ path: string; status: "available"; gitRoot: string } | { path: string; status: "missing" })[];
};

export type ApiErrorCode = "forbidden" | "not_found" | "method_not_allowed" | "internal_error";

export type WorkspaceChanges = {
	codebases: Record<string, { root: string; guidance: string; type?: string }>;
	changes: {
		repo: string;
		path: string;
		kind: "added" | "modified" | "deleted" | "renamed";
		from?: string;
		codebases: string[];
	}[];
};
