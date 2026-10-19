import { pathToFileURL } from "node:url";
import { validRepositoryPath } from "./repositories.ts";
import type { WorkspacePolicy } from "./types.ts";

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
