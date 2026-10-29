import {
	type AnalysisHandlerIdentity,
	type AnalysisNode,
	createAnalysisTree,
	finalizeAnalysis,
	type WorkspaceTree,
} from "../../workspace-tree/index.ts";
import { deemphasizeDirectories, warnLargeMarkdown } from "./builtins.ts";
import {
	AnalysisHandlerError,
	type AnalysisResult,
	type AnalysisRoot,
	type RegisteredAnalysisHandler,
} from "./types.ts";
export interface TreeAnalyzerDeps {
	readonly handlers: readonly RegisteredAnalysisHandler[];
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
	const registry: readonly RegisteredAnalysisHandler[] = [
		{ identity: { id: "builtin:deemphasize-directories" }, handler: deemphasizeDirectories },
		{ identity: { id: "builtin:large-markdown" }, handler: warnLargeMarkdown },
		...deps.handlers,
	];
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
			const sizes = new Map<AnalysisNode, Promise<number>>();
			const root = Object.assign(tree.root, {
				signal: options.signal,
				source: {
					currentByteSize(node: AnalysisNode) {
						checkActive();
						if (tree.nodes.get(node.path) !== node || node.current?.kind !== "file")
							return Promise.reject(new TypeError("Size lookup requires a current regular file in this run"));
						let pending = sizes.get(node);
						if (!pending) {
							pending = Promise.resolve()
								.then(() => {
									checkActive();
									return options.currentByteSize(node, options.signal);
								})
								.then((value) => {
									checkActive();
									return value;
								});
							sizes.set(node, pending);
						}
						return pending;
					},
				},
			}) as AnalysisRoot;
			Object.defineProperty(root, "handler", { get: currentHandler });
			try {
				for (const registration of registry) {
					checkActive();
					current = registration.identity;
					if (registration.error) throw registration.error;
					try {
						const returned = registration.handler?.(root);
						if (returned) await abortable(Promise.resolve(returned), options.signal);
						checkActive();
					} catch (cause) {
						options.signal.throwIfAborted();
						throw new AnalysisHandlerError(registration.identity, cause);
					}
				}
				checkActive();
				return { ...finalizeAnalysis(tree), handlers: registry.map((item) => item.identity) };
			} finally {
				active = false;
				current = undefined;
			}
		},
	};
}
