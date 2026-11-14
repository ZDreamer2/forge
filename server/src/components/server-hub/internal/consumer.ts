import { fetchSelection } from "./fetch-selection.ts";
import type { ObservedServer, ProbeDependencies, SelectedHub, SelectedHubSource } from "./types.ts";

export interface SelectedHubDeps {
	readonly source: SelectedHubSource;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => number;
	readonly setTimeout?: ProbeDependencies["setTimeout"];
	readonly clearTimeout?: ProbeDependencies["clearTimeout"];
}

export function createSelectedHub(deps: SelectedHubDeps): SelectedHub {
	const now = deps.now ?? Date.now;
	const io: ProbeDependencies = {
		fetch: deps.fetch ?? globalThis.fetch,
		setTimeout: deps.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)),
		clearTimeout:
			deps.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)),
	};
	let source = { ...deps.source };
	let servers: readonly ObservedServer[] | null = null;
	let lastSuccess: number | null = null;
	let error: string | null = null;
	let started = false;
	let closed = false;
	let generation = 0;
	let timer: { handle: unknown } | undefined;
	let active: { controller: AbortController; promise: Promise<void> } | undefined;
	let closing: Promise<void> | undefined;

	function clearTimer() {
		if (timer) io.clearTimeout(timer.handle);
		timer = undefined;
	}

	function launch() {
		if (closed || !started || active || source.status !== "selected") return;
		clearTimer();
		const selectedGeneration = generation;
		const round = { controller: new AbortController(), promise: Promise.resolve() };
		active = round;
		round.promise = fetchSelection(source.url, round.controller.signal, io)
			.then((result) => {
				if (closed || round.controller.signal.aborted || generation !== selectedGeneration) return;
				error = result.error;
				if (result.servers !== null) {
					servers = result.servers;
					lastSuccess = now();
				}
			})
			.finally(() => {
				if (active !== round) return;
				active = undefined;
				if (closed || source.status !== "selected") return;
				if (generation !== selectedGeneration) launch();
				else
					timer = {
						handle: io.setTimeout(() => {
							timer = undefined;
							launch();
						}, 30_000),
					};
			});
	}

	return {
		inspect() {
			const stale =
				source.status === "configuration-unavailable" ||
				(source.status === "selected" && (lastSuccess === null || error !== null || now() - lastSuccess > 90_000));
			return Object.freeze({
				source: Object.freeze({ status: source.status, url: source.status === "selected" ? source.url : null }),
				servers:
					servers === null
						? null
						: Object.freeze(
								servers.map((server) =>
									Object.freeze({
										...server,
										availability: Object.freeze({ ...server.availability, stale: stale || server.availability.stale }),
									}),
								),
							),
				lastSuccessAt: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
				error:
					source.status === "configuration-unavailable" ? source.error.replace(/\p{Cc}/gu, " ").slice(0, 320) : error,
				stale,
			});
		},
		replaceSource(next) {
			if (closed) return closing ?? Promise.resolve();
			if (
				source.status === next.status &&
				(source.status !== "selected" || (next.status === "selected" && source.url === next.url))
			) {
				source = { ...next };
				return Promise.resolve();
			}
			source = { ...next };
			generation++;
			servers = null;
			lastSuccess = null;
			error = null;
			clearTimer();
			if (active) {
				active.controller.abort();
				return active.promise;
			}
			launch();
			return Promise.resolve();
		},
		start() {
			if (!closed && !started) {
				started = true;
				launch();
			}
		},
		close() {
			if (closing) return closing;
			closed = true;
			clearTimer();
			active?.controller.abort();
			closing = active?.promise ?? Promise.resolve();
			return closing;
		},
	};
}
