import type { ClassificationNode, ClassificationValue } from "../../workspace-tree/index.ts";

/** Node-local assignments; every classifier completes before annotation starts. */
export type TreeClassificationHook = (context: TreeClassificationContext) => void | Promise<void>;

export interface TreeClassificationContext {
	readonly guide: { readonly id: `codebase:${string}` | "workspace" };
	readonly node: ClassificationNode;
	readonly signal: AbortSignal;
	/** Assign only this invocation's target, until the hook settles. */
	classify(value: ClassificationValue, reason?: string): void;
}
