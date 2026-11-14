import type { ServerRegistration } from "../../configuration/index.ts";
import { type ProbeDependencies, type ProbeResult, unavailable } from "./types.ts";

function isWorkspaceIdentity(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const identity = value as Record<string, unknown>;
	const workspace = identity.workspace;
	return (
		typeof workspace === "object" &&
		workspace !== null &&
		typeof (workspace as Record<string, unknown>).root === "string" &&
		typeof (workspace as Record<string, unknown>).name === "string" &&
		Array.isArray(identity.repositories)
	);
}

export async function probeWorkspace(
	registration: ServerRegistration,
	signal: AbortSignal,
	deps: ProbeDependencies,
): Promise<ProbeResult> {
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
	try {
		response = await deps.fetch(new URL("api/workspace", registration.url), {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "manual",
			credentials: "omit",
			signal: controller.signal,
		});
		if (!response.ok) return unavailable(`Workspace probe returned HTTP ${response.status}`);
		const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
		if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
			return unavailable("Workspace probe did not return JSON");
		}
		if (!response.body) return unavailable("Workspace probe returned an invalid workspace identity");
		reader = response.body.getReader();
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let bytes = 0;
		let text = "";
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > 64 * 1024) return unavailable("Workspace probe body exceeded 64 KiB");
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
		let identity: unknown;
		try {
			identity = JSON.parse(text);
		} catch {
			return unavailable("Workspace probe returned malformed JSON");
		}
		if (!isWorkspaceIdentity(identity)) return unavailable("Workspace probe returned an invalid workspace identity");
		if (controller.signal.aborted) return unavailable("Workspace probe was canceled");
		return { status: "reachable", error: null };
	} catch {
		return unavailable(
			timedOut
				? "Workspace probe exceeded its 3-second deadline"
				: signal.aborted
					? "Workspace probe was canceled"
					: "Workspace probe could not read a valid response",
		);
	} finally {
		controller.abort();
		deps.clearTimeout(timeout);
		signal.removeEventListener("abort", cancel);
		// Fetch exposes decoded bytes; cancellation also releases rejected or oversized bodies.
		try {
			if (reader) await reader.cancel();
			else await response?.body?.cancel();
		} catch {
			// An aborted transport may already have errored its body.
		} finally {
			reader?.releaseLock();
		}
	}
}
