import type { RootedCodebase, WorkspaceConfig } from "./types.ts";

export function rootedCodebases(registry: WorkspaceConfig): readonly RootedCodebase[] {
	return registry.guides.filter((guide): guide is RootedCodebase => guide.root !== undefined);
}
