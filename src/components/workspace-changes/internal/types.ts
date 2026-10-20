import type { CodebaseContext, WorkspaceChange } from "../../workspace-policy/index.ts";

export interface CollectedChange extends WorkspaceChange {
	readonly binary: boolean;
	readonly addedLines: number | null;
	readonly removedLines: number | null;
	readonly codebases: readonly CodebaseContext[];
}

export interface TreeEntry {
	readonly mode: string;
	readonly oid: string;
	readonly path: string;
}

export interface RawChange {
	readonly oldMode: string;
	readonly newMode: string;
	readonly oldOid: string;
	readonly newOid: string;
	readonly status: string;
	readonly oldPath: string;
	readonly newPath: string;
}
