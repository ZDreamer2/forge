import { relative, sep } from "node:path";
import type { FileSide as WireSide, WorkspaceChanges, WorkspaceFileDiff } from "../../api-contract/index.ts";
import type { FileDiffResult, FileSide } from "../../tree-sources/index.ts";

function createFileMapping(root: string) {
	const definitions = new Map<string, WorkspaceChanges["codebases"][string]>();
	const workspacePath = (path: string) => relative(root, path).split(sep).join("/") || ".";
	return {
		side(value: FileSide): WireSide {
			const { codebase, ...metadata } = value;
			if (!codebase) return metadata;
			const id = workspacePath(codebase.root);
			definitions.set(id, {
				root: id,
				guidance: workspacePath(codebase.guide),
				...(codebase.type ? { type: codebase.type.id } : {}),
			});
			return { ...metadata, codebase: id };
		},
		definitions: () => Object.fromEntries(definitions),
	};
}

export function workspaceFileDiff(root: string, result: FileDiffResult): WorkspaceFileDiff {
	const mapping = createFileMapping(root);
	if (result.kind === "not_changed") return { ...result, codebases: {} };
	const base = mapping.side(result.base);
	const current = mapping.side(result.current);
	return { ...result, base, current, codebases: mapping.definitions() };
}
