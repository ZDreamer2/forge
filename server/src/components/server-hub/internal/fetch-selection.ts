import type { ObservedServer, ProbeDependencies } from "./types.ts";

export type SelectionFetchResult =
	| { readonly servers: readonly ObservedServer[]; readonly error: null }
	| { readonly servers: null; readonly error: string };

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function timestamp(value: unknown): value is string | null {
	if (value === null) return true;
	if (typeof value !== "string") return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function baseUrl(value: unknown): value is string {
	if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 2048 || !/^https?:\/\//i.test(value))
		return false;
	try {
		const url = new URL(value);
		if (
			!url.hostname ||
			url.username ||
			url.password ||
			/^https?:\/\/[^/]*@/i.test(value) ||
			/[\\?#]/u.test(value) ||
			Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
		)
			return false;
		url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
		return url.href === value;
	} catch {
		return false;
	}
}

function parseServers(value: unknown): readonly ObservedServer[] | null {
	const payload = record(value);
	if (!payload || !Array.isArray(payload.servers) || payload.servers.length > 64) return null;
	const ids = new Set<string>();
	const servers: ObservedServer[] = [];
	for (const item of payload.servers) {
		const entry = record(item);
		if (
			!entry ||
			typeof entry.id !== "string" ||
			!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id) ||
			Buffer.byteLength(entry.id, "utf8") > 128 ||
			ids.has(entry.id) ||
			typeof entry.name !== "string" ||
			!entry.name.trim() ||
			Buffer.byteLength(entry.name, "utf8") > 256 ||
			!baseUrl(entry.url)
		)
			return null;
		ids.add(entry.id);
		const observation = record(entry.availability);
		if (
			!observation ||
			!timestamp(observation.checkedAt) ||
			!timestamp(observation.lastReachableAt) ||
			typeof observation.stale !== "boolean" ||
			!(observation.error === null || (typeof observation.error === "string" && observation.error.length <= 320))
		)
			return null;
		const { status, checkedAt, lastReachableAt, error, stale } = observation;
		if (status === "unknown") {
			if (checkedAt !== null || lastReachableAt !== null || error !== null || !stale) return null;
		} else if (status === "reachable") {
			if (checkedAt === null || lastReachableAt !== checkedAt || error !== null) return null;
		} else if (status === "unavailable") {
			if (
				checkedAt === null ||
				typeof error !== "string" ||
				!error ||
				(lastReachableAt !== null && Date.parse(lastReachableAt) > Date.parse(checkedAt))
			)
				return null;
		} else return null;
		servers.push(
			Object.freeze({
				id: entry.id,
				name: entry.name,
				url: entry.url,
				availability: Object.freeze({ status, checkedAt, lastReachableAt, error, stale }),
			}),
		);
	}
	return Object.freeze(servers);
}

export async function fetchSelection(
	url: string,
	signal: AbortSignal,
	deps: ProbeDependencies,
): Promise<SelectionFetchResult> {
	const controller = new AbortController();
	let timedOut = false;
	const cancel = () => controller.abort();
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	const timeout = deps.setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, 3_000);
	let response: Response | undefined;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const failure = (error: string): SelectionFetchResult => ({ servers: null, error });
	try {
		response = await deps.fetch(new URL("api/server-hub/servers", url), {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "manual",
			credentials: "omit",
			signal: controller.signal,
		});
		if (!response.ok) return failure(`Selected hub returned HTTP ${response.status}`);
		const media = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
		if (media !== "application/json" && !media?.endsWith("+json")) return failure("Selected hub did not return JSON");
		if (!response.body) return failure("Selected hub returned an incompatible server list");
		reader = response.body.getReader();
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let size = 0;
		let text = "";
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 1024 * 1024) return failure("Selected hub body exceeded 1 MiB");
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return failure("Selected hub returned malformed JSON");
		}
		const servers = parseServers(parsed);
		if (servers === null) return failure("Selected hub returned an incompatible server list");
		if (controller.signal.aborted) return failure("Selected hub fetch was canceled");
		return { servers, error: null };
	} catch {
		return failure(
			timedOut
				? "Selected hub exceeded its 3-second deadline"
				: signal.aborted
					? "Selected hub fetch was canceled"
					: "Selected hub could not read a valid response",
		);
	} finally {
		controller.abort();
		deps.clearTimeout(timeout);
		signal.removeEventListener("abort", cancel);
		try {
			if (reader) await reader.cancel();
			else await response?.body?.cancel();
		} catch {
			// Aborting the request may already have errored the body.
		} finally {
			reader?.releaseLock();
		}
	}
}
