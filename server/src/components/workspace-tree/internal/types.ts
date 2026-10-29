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
	readonly renameContentChanged?: boolean;
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
	readonly renameContentChanged?: boolean;
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

export interface CodebaseFacts {
	readonly root: string;
	readonly guide: string;
	readonly type?: { readonly id: string; readonly guide: string };
}
export interface AnalysisHandlerIdentity {
	readonly id: string;
	readonly codebase?: CodebaseFacts;
}
export type Emphasis = "normal" | "emphasized" | "deemphasized" | "hidden";
export interface ExplicitEmphasis {
	readonly value: Emphasis;
	readonly reason: string;
	readonly handler: AnalysisHandlerIdentity;
}
export interface EffectiveEmphasis {
	readonly value: Emphasis;
	readonly reason?: string;
	readonly handler?: AnalysisHandlerIdentity;
	readonly origin?: string;
}
export interface SignalLocation {
	readonly side: "base" | "current";
	readonly line: number;
	readonly column?: number;
}
export interface AnalysisSignal {
	readonly severity: "notice" | "warning";
	readonly message: string;
	readonly handler: AnalysisHandlerIdentity;
	readonly location?: SignalLocation;
}
export interface AnalysisSide extends Omit<TreeSide, "codebase" | "codebaseRoot"> {
	readonly codebase?: CodebaseFacts;
	readonly codebaseRoot?: CodebaseFacts;
}
export interface AnalysisNode extends Omit<Readonly<TreeNode>, "base" | "current"> {
	readonly base?: AnalysisSide;
	readonly current?: AnalysisSide;
	readonly parent?: AnalysisNode;
	readonly children: readonly AnalysisNode[];
	readonly emphasis?: ExplicitEmphasis;
	readonly signals: readonly AnalysisSignal[];
	walk(): Iterable<AnalysisNode>;
	deemphasize(reason: string): void;
	restoreNormalEmphasis(reason?: string): void;
	emphasize(reason: string): void;
	hide(reason: string): void;
	warn(message: string, location?: SignalLocation): void;
	notice(message: string, location?: SignalLocation): void;
}
export interface FinalAnalysisNode {
	readonly node: AnalysisNode;
	readonly effectiveEmphasis: EffectiveEmphasis;
	readonly rawTotals: LineTotals;
	readonly attentionTotals: LineTotals;
	readonly signalCounts: { readonly notice: number; readonly warning: number };
}
export interface AnalysisTree {
	readonly root: AnalysisNode;
	readonly nodes: ReadonlyMap<string, AnalysisNode>;
}
export interface FinalAnalysisTree {
	readonly root: ".";
	readonly nodes: ReadonlyMap<string, FinalAnalysisNode>;
}
