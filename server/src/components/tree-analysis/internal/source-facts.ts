import type { AnalysisNode, AnalysisTree } from "../../workspace-tree/index.ts";
import type { TreeSourceFacts } from "./annotation-hook.ts";

interface Deps {
	readonly tree: AnalysisTree;
	readonly signal: AbortSignal;
	readonly checkActive: () => void;
	readonly read: (node: AnalysisNode, signal: AbortSignal) => Promise<number>;
}
export function createSourceFacts(deps: Deps): TreeSourceFacts & { close(): void } {
	const cache = new Map<AnalysisNode, Promise<number>>();
	const queue: { node: AnalysisNode; resolve: (size: number) => void; reject: (cause: unknown) => void }[] = [];
	let running = 0;
	let closed = false;
	function close() {
		closed = true;
		for (const task of queue.splice(0))
			task.reject(deps.signal.reason ?? new Error("Analysis run is no longer active"));
		deps.signal.removeEventListener("abort", close);
	}
	function pump() {
		while (!closed && running < 2 && queue.length) {
			const task = queue.shift();
			if (!task) break;
			running++;
			Promise.resolve()
				.then(() => {
					deps.checkActive();
					return deps.read(task.node, deps.signal);
				})
				.then((size) => {
					deps.checkActive();
					task.resolve(size);
				})
				.catch(task.reject)
				.finally(() => {
					running--;
					pump();
				});
		}
	}
	deps.signal.addEventListener("abort", close, { once: true });
	return {
		currentByteSize(node) {
			deps.checkActive();
			if (deps.tree.nodes.get(node.path) !== node || node.current?.kind !== "file")
				return Promise.reject(new TypeError("Size lookup requires a current regular file in this run"));
			let pending = cache.get(node);
			if (!pending) {
				pending = new Promise<number>((resolve, reject) => {
					queue.push({ node, resolve, reject });
				});
				cache.set(node, pending);
				pump();
			}
			return pending;
		},
		close,
	};
}
