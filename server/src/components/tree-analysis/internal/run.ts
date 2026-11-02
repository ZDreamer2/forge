import type { WorkspaceConfig } from "../../workspace-config/index.ts";
import {
	type AnalysisHandlerIdentity,
	type AnalysisNode,
	createAnalysisTree,
	finalizeAnalysis,
	type WorkspaceTree,
} from "../../workspace-tree/index.ts";
import { createInvocationOrder } from "./invocation-order.ts";
import { createSourceFacts } from "./source-facts.ts";
import { type AnalysisContribution, AnalysisHandlerError, type AnalysisResult } from "./types.ts";
export interface TreeAnalyzerDeps {
	readonly config: WorkspaceConfig;
	readonly extensions: readonly AnalysisContribution[];
}
export interface AnalysisRunOptions {
	readonly signal: AbortSignal;
	readonly currentByteSize: (node: AnalysisNode, signal: AbortSignal) => Promise<number>;
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
		if (signal.aborted) abort();
	});
}
export function createTreeAnalyzer(deps: TreeAnalyzerDeps) {
	const order = createInvocationOrder(deps.config);
	const registry = new Map(deps.extensions.map((item) => [item.id, item]));
	return {
		async analyze(base: WorkspaceTree, options: AnalysisRunOptions): Promise<AnalysisResult> {
			let current: AnalysisHandlerIdentity | undefined;
			let active = true;
			const checkActive = () => {
				options.signal.throwIfAborted();
				if (!active) throw new Error("Analysis run is no longer active");
			};
			const currentHandler = () => {
				checkActive();
				if (!current) throw new Error("No active analysis handler");
				return current;
			};
			const tree = createAnalysisTree(base, { checkActive, currentHandler });
			const source = createSourceFacts({ tree, signal: options.signal, checkActive, read: options.currentByteSize });
			const invoked = new Map<string, AnalysisHandlerIdentity>();
			try {
				// Annotation can inspect any relative, so classification must finish for
				// the whole tree before the first annotation invocation.
				for (const phase of ["classifyNode", "annotateNode"] as const) {
					for (const node of tree.root.walk()) {
						for (const id of order(node)) {
							checkActive();
							const extension = registry.get(id);
							if (!extension) continue;
							const identity = { id: `${id}#${phase}` };
							if (extension.error) throw new AnalysisHandlerError(identity, extension.error);
							if (!extension[phase]) continue;
							current = identity;
							invoked.set(identity.id, identity);
							let invoking = true;
							try {
								const returned =
									phase === "classifyNode"
										? extension.classifyNode?.({
												node: tree.classificationFacts(node),
												guide: { id },
												signal: options.signal,
												classify(value, reason) {
													checkActive();
													if (!invoking) throw new Error("Classification invocation is no longer active");
													tree.classify(node, value, reason);
												},
											})
										: extension.annotateNode?.({ node, guide: { id }, signal: options.signal, source });
								if (returned) await abortable(Promise.resolve(returned), options.signal);
								checkActive();
							} catch (cause) {
								options.signal.throwIfAborted();
								throw new AnalysisHandlerError(identity, cause);
							} finally {
								invoking = false;
								current = undefined;
							}
						}
					}
				}
				checkActive();
				return { ...finalizeAnalysis(tree), handlers: [...invoked.values()] };
			} finally {
				active = false;
				current = undefined;
				source.close();
			}
		},
	};
}
