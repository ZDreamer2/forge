type Options = { operation: string; timeoutMs?: number };

/** Each owner keeps independent request budgets, admission and source-operation drains. */
export function createRequestRuns({ operation: label, timeoutMs = 30_000 }: Options) {
	let accepting = true;
	const active = new Map<AbortController, Promise<unknown>>();
	return {
		run<T>(
			work: (signal: AbortSignal, own: <R>(pending: Promise<R>) => Promise<R>) => Promise<T>,
			clientSignal?: AbortSignal,
		): Promise<T> {
			if (!accepting) return Promise.reject(new Error("Forge is shutting down"));
			const controller = new AbortController();
			const abortClient = () => controller.abort(clientSignal?.reason);
			if (clientSignal?.aborted) abortClient();
			else clientSignal?.addEventListener("abort", abortClient, { once: true });
			const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs);
			const signal = controller.signal;
			let abort: () => void;
			const cancelled = new Promise<never>((_, reject) => {
				abort = () => reject(signal.reason);
				if (signal.aborted) abort();
				else signal.addEventListener("abort", abort, { once: true });
			});
			const sourceOperations = new Set<Promise<unknown>>();
			const own = <R>(pending: Promise<R>): Promise<R> => {
				sourceOperations.add(pending);
				pending.then(
					() => sourceOperations.delete(pending),
					() => sourceOperations.delete(pending),
				);
				return pending;
			};
			const operation = Promise.resolve().then(() => {
				signal.throwIfAborted();
				return work(signal, own);
			});
			// Promise.race observes late failures even if cancellation wins first.
			const promise = Promise.race([operation, cancelled]).finally(async () => {
				// Only explicitly owned source work is drained; shared collection and handler waits remain abandonable.
				controller.abort(new Error(`${label} finished`));
				await Promise.allSettled([...sourceOperations]);
				clearTimeout(timer);
				clientSignal?.removeEventListener("abort", abortClient);
				signal.removeEventListener("abort", abort);
				active.delete(controller);
			});
			active.set(controller, promise);
			return promise;
		},
		async close(): Promise<void> {
			accepting = false;
			const pending = [...active];
			for (const [controller] of pending) controller.abort(new Error("Forge is shutting down"));
			await Promise.allSettled(pending.map(([, promise]) => promise));
		},
	};
}
