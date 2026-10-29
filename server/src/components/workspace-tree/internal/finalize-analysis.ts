import type { AnalysisTree, EffectiveEmphasis, FinalAnalysisNode, FinalAnalysisTree } from "./types.ts";

export function finalizeAnalysis(tree: AnalysisTree): FinalAnalysisTree {
	const order = [...tree.root.walk()];
	const effective = new Map<string, EffectiveEmphasis>();
	for (const node of order) {
		effective.set(
			node.path,
			node.emphasis
				? { ...node.emphasis, origin: node.path }
				: ((node.parent ? effective.get(node.parent.path) : undefined) ?? { value: "normal" }),
		);
	}
	const nodes = new Map<string, FinalAnalysisNode>();
	for (const node of order.reverse()) {
		const emphasis = effective.get(node.path) ?? { value: "normal" };
		const own = node.statistics && !node.statistics.binary ? node.statistics : { added: 0, removed: 0 };
		const rawTotals = { added: own.added, removed: own.removed };
		const included = emphasis.value === "normal" || emphasis.value === "emphasized";
		const attentionTotals = { added: included ? own.added : 0, removed: included ? own.removed : 0 };
		const signalCounts = { notice: 0, warning: 0 };
		for (const signal of node.signals) signalCounts[signal.severity]++;
		for (const child of node.children) {
			const result = nodes.get(child.path);
			if (!result) continue;
			rawTotals.added += result.rawTotals.added;
			rawTotals.removed += result.rawTotals.removed;
			attentionTotals.added += result.attentionTotals.added;
			attentionTotals.removed += result.attentionTotals.removed;
			signalCounts.notice += result.signalCounts.notice;
			signalCounts.warning += result.signalCounts.warning;
		}
		nodes.set(node.path, { node, effectiveEmphasis: emphasis, rawTotals, attentionTotals, signalCounts });
	}
	return { root: ".", nodes };
}
