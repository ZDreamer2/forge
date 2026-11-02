import type { AnalysisHandlerIdentity, FinalAnalysisTree } from "../../workspace-tree/index.ts";
import type { TreeAnnotationHook } from "./annotation-hook.ts";
import type { TreeClassificationHook } from "./classification-hook.ts";
export interface AnalysisContribution {
	readonly id: `codebase:${string}` | "workspace";
	readonly classifyNode?: TreeClassificationHook;
	readonly annotateNode?: TreeAnnotationHook;
	readonly error?: Error;
}
export interface AnalysisResult extends FinalAnalysisTree {
	readonly handlers: readonly AnalysisHandlerIdentity[];
}
export class AnalysisHandlerError extends Error {
	readonly handler: AnalysisHandlerIdentity;
	#privateCause: unknown;
	constructor(handler: AnalysisHandlerIdentity, cause: unknown) {
		super(`Analysis handler failed: ${handler.id}`);
		this.handler = handler;
		this.#privateCause = cause;
	}
	diagnostic(): string {
		return this.#privateCause instanceof Error ? this.#privateCause.message : "Handler threw a non-Error value";
	}
}
