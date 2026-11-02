// Hook owners define semantics and vocabulary; this facade lists known hooks so
// author typechecking and module loading can reject unknown contributions.
import type { TreeAnnotationHook, TreeClassificationHook } from "../../tree-analysis/index.ts";

export type {
	AnalysisNode,
	AnalysisSide,
	AnalysisSignal,
	Classification,
	ClassificationNode,
	ClassificationValue,
	CodebaseFacts,
	Emphasis,
	ExplicitEmphasis,
	LineStatistics,
	NodeKind,
	SignalLocation,
	TreeAnnotationContext,
	TreeAnnotationHook,
	TreeClassificationContext,
	TreeClassificationHook,
	TreeSourceFacts,
} from "../../tree-analysis/index.ts";

/**
 * Default export of a guide's forge-extension/forge-extension.ts entry: its
 * interface to the Forge engine. The unit owns private internal/ modules and
 * tests/; the guide remains the extension identity. Hooks are optional; a hook
 * unknown to the loading engine is a load error.
 */
export interface ForgeExtension {
	/** Contract revision; it changes only for breaking hook semantics. */
	readonly api: 1;
	readonly classifyNode?: TreeClassificationHook;
	readonly annotateNode?: TreeAnnotationHook;
}
