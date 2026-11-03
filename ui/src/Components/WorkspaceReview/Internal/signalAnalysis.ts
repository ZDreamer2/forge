import type { AnalysisSignal, AnalysisWireNode, WorkspaceAnalysis } from "@forge/api-contract";

export type SignalMessage = AnalysisSignal & {
	key: string;
	sourcePath: string;
	displayPath: string;
	direct: boolean;
};
type SourceMessage = Omit<SignalMessage, "direct">;
type SignalRange = { node: AnalysisWireNode; start: number; end: number };
export type SignalAnalysis = {
	records: readonly SourceMessage[];
	ranges: ReadonlyMap<string, SignalRange>;
};

export function analyzeSignals(analysis: Pick<WorkspaceAnalysis, "root" | "nodes"> | undefined): SignalAnalysis {
	const records: SourceMessage[] = [];
	const ranges = new Map<string, SignalRange>();
	function collect(path: string) {
		const node = analysis?.nodes[path];
		if (!node) return;
		const start = records.length;
		const directory =
			path === "." || node.children.length > 0 || node.current?.kind === "directory" || node.base?.kind === "directory";
		for (const [index, signal] of node.signals.entries())
			records.push({
				...signal,
				key: `${path}:${index}`,
				sourcePath: path,
				displayPath: directory ? `${path}/` : path,
			});
		for (const child of node.children) collect(child);
		ranges.set(path, { node, start, end: records.length });
	}
	// Canonical child links include nested repositories. Display placeholder
	// parenting and repository-owned change totals do not define signal membership.
	if (analysis) collect(analysis.root);
	return { records, ranges };
}

export function signalMessages(analysis: SignalAnalysis, path: string): SignalMessage[] {
	const range = analysis.ranges.get(path);
	if (!range) return [];
	// Contiguous traversal ranges avoid copying subtree lists onto every ancestor.
	return analysis.records.slice(range.start, range.end).map((record) => ({
		...record,
		direct: record.sourcePath === path,
	}));
}

export function signalSummary(analysis: SignalAnalysis, path: string) {
	const node = analysis.ranges.get(path)?.node;
	return {
		warning: {
			inclusive: (node?.signalCounts.warning ?? 0) > 0,
			direct: node?.signals.some((signal) => signal.severity === "warning") ?? false,
		},
		notice: {
			inclusive: (node?.signalCounts.notice ?? 0) > 0,
			direct: node?.signals.some((signal) => signal.severity === "notice") ?? false,
		},
	};
}
