import { createRequestRuns } from "./request-runs.ts";

type Options = { timeoutMs?: number };

/** Independent request budgets surround shared collection and run-local handler work. */
export function createAnalysis({ timeoutMs }: Options = {}) {
	return createRequestRuns({ operation: "Workspace analysis", timeoutMs });
}
