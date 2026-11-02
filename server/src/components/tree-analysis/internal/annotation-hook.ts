import type { AnalysisNode } from "../../workspace-tree/index.ts";

/**
 * Source-read-only emphasis and signal phase. Runs once per applicable guide for each
 * canonical node, attributed as `<namespaced guide id>#annotateNode`. The
 * classification phase completes for every node before this phase starts.
 */
export type TreeAnnotationHook = (context: TreeAnnotationContext) => void | Promise<void>;

/**
 * Per-invocation capabilities of `annotateNode`. Use them only until the hook
 * settles; retain no context, node or source capability afterward.
 */
export interface TreeAnnotationContext {
	/** Namespaced guide identity, independent of the node's side ownership. */
	readonly guide: { readonly id: `codebase:${string}` | "workspace" };
	/**
	 * Current invocation target. Parent/children navigation exposes the whole tree;
	 * trusted hooks may annotate any reachable node and must handle repeated calls.
	 */
	readonly node: AnalysisNode;
	/** Cooperative cancellation for asynchronous work. */
	readonly signal: AbortSignal;
	readonly source: TreeSourceFacts;
}

/** Bounded, run-local observations of current workspace content. */
export interface TreeSourceFacts {
	/** Byte size of a current regular file in this run, without reading content. */
	currentByteSize(node: AnalysisNode): Promise<number>;
}
