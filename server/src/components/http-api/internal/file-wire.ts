import type { FileSide as WireSide, WorkspaceChanges, WorkspaceFileDiff } from "../../api-contract/index.ts";
import type { FileDiffResult, FileSide } from "../../tree-sources/index.ts";
import { codebaseDefinition } from "./codebase-definition.ts";

function createFileMapping(root: string) {
	const definitions = new Map<string, WorkspaceChanges["codebases"][string]>();
	return {
		side(value: FileSide): WireSide {
			const { codebase, ...metadata } = value;
			if (!codebase) return metadata;
			const { rootKey, definition } = codebaseDefinition(root, codebase);
			definitions.set(rootKey, definition);
			return { ...metadata, codebase: rootKey };
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
