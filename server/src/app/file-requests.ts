import { createRequestRuns } from "./request-runs.ts";

type Options = { timeoutMs?: number };

/** File requests cancel independently while shared collection retains its own owner. */
export function createFileRequests({ timeoutMs }: Options = {}) {
	return createRequestRuns({ operation: "File request", timeoutMs });
}
