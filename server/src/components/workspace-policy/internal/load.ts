import { pathToFileURL } from "node:url";
import type { WorkspacePolicy } from "../authoring/index.ts";
import { validRepositoryPath } from "./repositories.ts";

/** Imports execute trusted workspace code; this is not a sandbox or hot loader. */
export async function loadWorkspacePolicy(absolutePath: string): Promise<WorkspacePolicy> {
	const module: { default?: unknown } = await import(pathToFileURL(absolutePath).href);
	const policy = module.default;
	if (
		typeof policy !== "object" ||
		policy === null ||
		!("repositories" in policy) ||
		!Array.isArray(policy.repositories) ||
		!("codebasesForChange" in policy) ||
		typeof policy.codebasesForChange !== "function"
	) {
		throw new TypeError("Workspace module must default-export a WorkspacePolicy");
	}
	if ("displayName" in policy && (typeof policy.displayName !== "string" || policy.displayName.length === 0)) {
		throw new TypeError("Workspace displayName must be a nonempty string");
	}
	const paths = new Set<string>();
	for (const repository of policy.repositories) {
		if (
			typeof repository !== "object" ||
			repository === null ||
			typeof repository.path !== "string" ||
			!validRepositoryPath(repository.path) ||
			paths.has(repository.path)
		) {
			throw new TypeError("Repository declarations need unique normalized workspace-relative paths");
		}
		paths.add(repository.path);
	}
	return policy as WorkspacePolicy;
}
