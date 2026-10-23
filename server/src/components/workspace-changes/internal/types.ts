import type { WorkspaceChange } from "../../workspace-policy/index.ts";

export interface CollectedChange extends WorkspaceChange {
	readonly codebases: readonly string[];
}

export interface CollectedWorkspaceChanges {
	readonly codebases: Readonly<Record<string, { readonly guidance: string }>>;
	readonly changes: readonly CollectedChange[];
}
