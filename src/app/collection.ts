type Deps<T> = {
	collect: (signal: AbortSignal) => Promise<T>;
	timeoutMs?: number;
};

/** One live operation shared by callers; settled results are never cached. */
export function createCollection<T>({ collect, timeoutMs = 30_000 }: Deps<T>) {
	let accepting = true;
	let active: { controller: AbortController; promise: Promise<T> } | undefined;
	return {
		collect(): Promise<T> {
			if (!accepting) return Promise.reject(new Error("Forge is shutting down"));
			if (active) return active.promise;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(new Error("Workspace collection timed out")), timeoutMs);
			const promise = Promise.resolve()
				.then(() => collect(controller.signal))
				.finally(() => {
					clearTimeout(timer);
					active = undefined;
				});
			active = { controller, promise };
			return promise;
		},
		async close(): Promise<void> {
			accepting = false;
			const pending = active;
			pending?.controller.abort(new Error("Forge is shutting down"));
			await pending?.promise.catch(() => {});
		},
	};
}
