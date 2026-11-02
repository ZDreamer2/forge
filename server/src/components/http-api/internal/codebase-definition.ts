import { relative, sep } from "node:path";
import type { WorkspaceChanges } from "../../api-contract/index.ts";

export function codebaseDefinition(
	root: string,
	codebase: { id: string; root: string; guide: string },
): { rootKey: string; definition: WorkspaceChanges["codebases"][string] } {
	const workspacePath = (path: string) => relative(root, path).split(sep).join("/") || ".";
	const rootKey = workspacePath(codebase.root);
	return { rootKey, definition: { id: codebase.id, root: rootKey, guidance: workspacePath(codebase.guide) } };
}
