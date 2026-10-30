import type { FileComparison } from "../../../../../lib/git/index.ts";

/** Facts parsed from Git before boundary corrections and pair reconciliation. */
export interface ComparedChange {
	readonly path: string;
	readonly kind: "added" | "modified" | "deleted" | "renamed";
	readonly from?: string;
	readonly renameContentChanged?: boolean;
	readonly oldMode: string;
	readonly newMode: string;
	readonly statistics: { readonly added: number; readonly removed: number; readonly binary: boolean };
	readonly correction?: "addition" | "deletion";
}

export type ReconciledChange = Omit<ComparedChange, "correction"> & {
	readonly comparison: FileComparison;
};

export interface ResolvedBaseline {
	readonly kind: "commit" | "unborn";
	/** The commit, or the resolved empty tree for an unborn repository. */
	readonly oid: string;
}

export type CollectedChange = ReconciledChange & {
	readonly baseline: ResolvedBaseline;
};
