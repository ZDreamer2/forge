import { resolve } from "node:path";
import { loadWorkspacePolicy } from "../components/workspace-policy/index.ts";

/** A lexical policy diagnostic; repository probes are explicit startup/reload work. */
export async function inspect(modulePath: string, repo: string, path: string, from?: string) {
	const policy = await loadWorkspacePolicy(resolve(modulePath));
	return {
		included: policy.repositories.some((repository) => repository.path === repo),
		codebases: policy.codebasesForChange({
			repo,
			path,
			kind: from === undefined ? "modified" : "renamed",
			...(from === undefined ? {} : { from }),
		}),
	};
}
