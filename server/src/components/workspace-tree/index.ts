export { codebaseFacts, createAnalysisTree } from "./internal/analysis-tree.ts";
export { finalizeAnalysis } from "./internal/finalize-analysis.ts";
export { createWorkspaceTree, WorkspaceTree } from "./internal/tree.ts";
export type {
	AnalysisHandlerIdentity,
	AnalysisNode,
	AnalysisSide,
	AnalysisSignal,
	AnalysisTree,
	CodebaseFacts,
	EffectiveEmphasis,
	Emphasis,
	ExplicitEmphasis,
	FinalAnalysisNode,
	FinalAnalysisTree,
	LineStatistics,
	LineTotals,
	NodeKind,
	SignalLocation,
	TreeContext,
	TreeEntry,
	TreeEntryNode,
	TreeNode,
	TreeSide,
} from "./internal/types.ts";
