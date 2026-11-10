import { relative, sep } from "node:path";
import type { GuidanceEntry, WorkspaceGuidance } from "../../api-contract/index.ts";
import {
	guideIdentity,
	type ResolvedGuide,
	resolveGuideChain,
	resolveWorkspaceChain,
	rootedCodebases,
	type WorkspaceConfig,
} from "../../workspace-config/index.ts";

export function resolveWorkspaceGuidance(root: string, name: string, config: WorkspaceConfig): WorkspaceGuidance {
	const workspace = resolveWorkspaceChain(config).guides;
	const inherited = new Set(workspace.map(guideIdentity));
	const workspacePath = (path: string) => relative(root, path).split(sep).join("/") || ".";
	const entry = (guide: ResolvedGuide, source: GuidanceEntry["source"]): GuidanceEntry => {
		const path = workspacePath(guide.guide);
		return {
			id: guideIdentity(guide),
			name: "id" in guide ? guide.id : name,
			...("id" in guide ? (guide.root === undefined ? {} : { root: workspacePath(guide.root) }) : { root: "." }),
			guidance: path === ".." || path.startsWith("../") ? guide.guide : path,
			source,
		};
	};
	return {
		workspace: workspace.map((guide) => entry(guide, "id" in guide ? "workspace-parent" : "workspace")),
		codebases: Object.fromEntries(
			rootedCodebases(config).map((owner) => [
				workspacePath(owner.root),
				resolveGuideChain(config, owner).guides.map((guide) =>
					entry(
						guide,
						!("id" in guide)
							? "workspace"
							: guide.id === owner.id
								? "project-folder"
								: inherited.has(guideIdentity(guide))
									? "workspace-parent"
									: "project-parent",
					),
				),
			]),
		),
	};
}
