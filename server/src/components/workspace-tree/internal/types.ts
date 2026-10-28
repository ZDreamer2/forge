import type { ResolvedCodebase } from "../../workspace-config/index.ts";

export type NodeKind = "directory" | "file" | "symlink";
export interface LineStatistics {
	readonly added: number;
	readonly removed: number;
	readonly binary: boolean;
}
export interface TreeEntry {
	readonly repo: string;
	readonly path: string;
	readonly kind?: "added" | "modified" | "deleted" | "renamed";
	readonly from?: string;
	readonly base?: { readonly kind: NodeKind };
	readonly current?: { readonly kind: NodeKind };
	readonly statistics?: LineStatistics;
}
export interface TreeSide {
	readonly path: string;
	readonly kind: NodeKind;
	readonly repository?: string;
	readonly codebase?: ResolvedCodebase;
	readonly repositoryRoot?: string;
	readonly codebaseRoot?: ResolvedCodebase;
}
export interface TreeNode {
	readonly path: string;
	readonly repo?: string;
	readonly kind?: TreeEntry["kind"];
	readonly from?: string;
	readonly base?: TreeSide;
	readonly current?: TreeSide;
	statistics?: LineStatistics;
}
export interface TreeEntryNode extends TreeNode {
	readonly repo: string;
}
export interface TreeContext {
	readonly root: string;
	readonly codebases: readonly ResolvedCodebase[];
	readonly repositories: readonly { readonly path: string }[];
}
export interface LineTotals {
	readonly added: number;
	readonly removed: number;
}
