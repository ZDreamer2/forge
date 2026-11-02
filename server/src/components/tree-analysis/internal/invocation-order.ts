import {
	guideIdentity,
	mergeGuideSequences,
	resolveCodebaseChain,
	resolveWorkspaceChain,
	rootedCodebases,
	type WorkspaceConfig,
} from "../../workspace-config/index.ts";
import type { AnalysisNode } from "../../workspace-tree/index.ts";

export function createInvocationOrder(config: WorkspaceConfig) {
	const workspace = resolveWorkspaceChain(config).guides;
	const owners = new Map(rootedCodebases(config).map((owner) => [owner.id, resolveCodebaseChain(config, owner)]));
	return (node: AnalysisNode) => {
		const chains = [workspace];
		for (const side of [node.base, node.current]) {
			if (side?.codebase) {
				const chain = owners.get(side.codebase.id);
				if (!chain) throw new Error(`Unknown analysis owner ${side.codebase.id} at ${node.path}`);
				chains.push(chain);
			}
		}
		return mergeGuideSequences(
			chains,
			`annotation node ${JSON.stringify(node.path)} (workspace, base, current owners)`,
		).map(guideIdentity);
	};
}
