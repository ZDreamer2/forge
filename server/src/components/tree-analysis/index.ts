export type {
	AnalysisHandlerIdentity,
	AnalysisNode,
	AnalysisSide,
	AnalysisSignal,
	CodebaseFacts,
	Emphasis,
	ExplicitEmphasis,
	FinalAnalysisNode,
	LineStatistics,
	NodeKind,
	SignalLocation,
} from "../workspace-tree/index.ts";
export type { TreeAnnotationContext, TreeAnnotationHook, TreeSourceFacts } from "./internal/annotation-hook.ts";
export type { AnalysisRunOptions, TreeAnalyzerDeps } from "./internal/run.ts";
export { createTreeAnalyzer } from "./internal/run.ts";
export type { AnalysisResult, AnnotationContribution } from "./internal/types.ts";
export { AnalysisHandlerError } from "./internal/types.ts";
