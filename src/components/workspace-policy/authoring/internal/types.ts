/** Paths use '/' and are workspace-relative; '.' identifies the main repository. */
export interface RepositoryDeclaration {
	readonly path: string;
}

export interface WorkspaceChange {
	readonly repo: string;
	readonly path: string;
	readonly kind: "added" | "modified" | "deleted" | "renamed";
	readonly from?: string;
}

/** Identity is concrete; several codebases may share the same guidance folder. */
export interface CodebaseContext {
	readonly id: string;
	readonly guidance: string;
}

/**
 * Trusted project code, called explicitly after loading. Forge probes only
 * declared repositories; missing locations are skipped, not configuration errors.
 * Routing is synchronous, side-effect-free and must handle absent
 * files lexically. Rename membership includes both old and new paths.
 */
export interface WorkspacePolicy {
	/** Literal display text; omission uses the canonical workspace root basename. */
	readonly displayName?: string;
	readonly repositories: readonly RepositoryDeclaration[];
	codebasesForChange(change: WorkspaceChange): readonly CodebaseContext[];
}
