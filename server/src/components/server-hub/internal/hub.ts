import type { ServerRegistration } from "../../configuration/index.ts";
import { probeWorkspace } from "./probe.ts";
import type { ProbeDependencies, ServerAvailability, ServerHub, ServerHubSnapshot } from "./types.ts";

export interface ServerHubDeps {
	readonly servers: readonly ServerRegistration[] | null;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => number;
	readonly setTimeout?: ProbeDependencies["setTimeout"];
	readonly clearTimeout?: ProbeDependencies["clearTimeout"];
	readonly reportError?: (message: string) => void;
}

interface Entry {
	registration: ServerRegistration;
	status: ServerAvailability["status"];
	checkedAt: number | null;
	lastReachableAt: number | null;
	error: string | null;
}

interface Round {
	readonly controller: AbortController;
	promise: Promise<void>;
}

export function createServerHub(deps: ServerHubDeps): ServerHub {
	const now = deps.now ?? Date.now;
	const io: ProbeDependencies = {
		fetch: deps.fetch ?? globalThis.fetch,
		setTimeout: deps.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)),
		clearTimeout:
			deps.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)),
	};
	let available = deps.servers !== null;
	let entries: Entry[] = [];
	let byId = new Map<string, Entry>();
	let started = false;
	let closed = false;
	let timer: { handle: unknown } | undefined;
	let active: Round | undefined;
	let refreshPending = false;
	let closing: Promise<void> | undefined;

	function clearTimer() {
		if (!timer) return;
		io.clearTimeout(timer.handle);
		timer = undefined;
	}

	function reportFailure() {
		try {
			deps.reportError?.("Server hub refresh could not complete; previous observations were retained");
		} catch {
			// Reporting must not prevent drain or future refreshes.
		}
	}

	async function runRound(round: Round, targets: readonly Entry[]) {
		let cursor = 0;
		async function worker() {
			while (!round.controller.signal.aborted) {
				const entry = targets[cursor++];
				if (!entry) return;
				try {
					const result = await probeWorkspace(entry.registration, round.controller.signal, io);
					if (round.controller.signal.aborted || closed || byId.get(entry.registration.id) !== entry) continue;
					const checkedAt = now();
					entry.status = result.status;
					entry.checkedAt = checkedAt;
					entry.error = result.error;
					if (result.status === "reachable") entry.lastReachableAt = checkedAt;
				} catch {
					if (!round.controller.signal.aborted) reportFailure();
				}
			}
		}
		await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
	}

	function launchRound() {
		if (closed || !started || active || !available || entries.length === 0) return;
		clearTimer();
		refreshPending = false;
		const round: Round = { controller: new AbortController(), promise: Promise.resolve() };
		active = round;
		round.promise = runRound(round, [...entries])
			.catch(reportFailure)
			.finally(() => {
				if (active !== round) return;
				active = undefined;
				if (closed) return;
				if (refreshPending) launchRound();
				else if (available && entries.length > 0) {
					timer = {
						handle: io.setTimeout(() => {
							timer = undefined;
							launchRound();
						}, 30_000),
					};
				}
			});
	}

	function replaceServers(servers: readonly ServerRegistration[] | null): Promise<void> {
		if (closed) return closing ?? Promise.resolve();
		const next = (servers ?? []).map((registration) => {
			const previous = byId.get(registration.id);
			const accepted = Object.freeze({ id: registration.id, name: registration.name, url: registration.url });
			if (previous?.registration.url === registration.url) {
				previous.registration = accepted;
				return previous;
			}
			return {
				registration: accepted,
				status: "unknown" as const,
				checkedAt: null,
				lastReachableAt: null,
				error: null,
			};
		});
		const changed =
			available !== (servers !== null) ||
			next.length !== entries.length ||
			next.some((entry) => byId.get(entry.registration.id) !== entry);
		available = servers !== null;
		entries = next;
		byId = new Map(next.map((entry) => [entry.registration.id, entry]));
		if (!changed || !started) return Promise.resolve();
		clearTimer();
		refreshPending = true;
		if (active) {
			active.controller.abort();
			return active.promise;
		}
		launchRound();
		return Promise.resolve();
	}

	void replaceServers(deps.servers);
	return {
		inspect(): ServerHubSnapshot | null {
			if (!available) return null;
			const inspectedAt = now();
			return Object.freeze({
				servers: Object.freeze(
					entries.map((entry) =>
						Object.freeze({
							...entry.registration,
							availability: Object.freeze({
								status: entry.status,
								checkedAt: entry.checkedAt === null ? null : new Date(entry.checkedAt).toISOString(),
								lastReachableAt: entry.lastReachableAt === null ? null : new Date(entry.lastReachableAt).toISOString(),
								error: entry.error,
								stale: entry.checkedAt === null || inspectedAt - entry.checkedAt > 90_000,
							}),
						}),
					),
				),
			});
		},
		replaceServers,
		start() {
			if (closed || started) return;
			started = true;
			launchRound();
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
