import type { AnalysisHandlerIdentity, AnalysisNode, FinalAnalysisTree } from "../../workspace-tree/index.ts";
export interface AnalysisRoot extends AnalysisNode {
	readonly handler: AnalysisHandlerIdentity;
	readonly signal: AbortSignal;
	readonly source: { currentByteSize(node: AnalysisNode): Promise<number> };
}
export type AnalysisHandler = (root: AnalysisRoot) => void | Promise<void>;
export interface RegisteredAnalysisHandler {
	readonly identity: AnalysisHandlerIdentity;
	readonly handler?: AnalysisHandler;
	readonly error?: AnalysisHandlerError;
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
