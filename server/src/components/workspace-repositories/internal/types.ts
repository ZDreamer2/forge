export type RepositoryResolution =
	| { readonly path: string; readonly status: "available"; readonly gitRoot: string }
	| { readonly path: string; readonly status: "missing" };
