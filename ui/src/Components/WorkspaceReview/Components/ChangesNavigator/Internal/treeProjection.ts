import type { AnalysisWireNode } from "@forge/api-contract";
import {
	type Importance,
	importanceOf,
	type ReviewAnalysis,
	type ReviewSubject,
	summarizeEntries,
} from "../../../Internal/changeAnalysis";

export type ProjectedNode = ReviewSubject & {
	children: string[];
	visible: boolean;
	kind?: AnalysisWireNode["kind"];
	importance?: Importance;
};
export type TreeProjection = {
	root?: ProjectedNode;
	nodes: Map<string, ProjectedNode>;
	branches: Set<string>;
	all: ReviewAnalysis["all"];
	visible: ReviewAnalysis["visible"];
};

export function projectTree(review: ReviewAnalysis): TreeProjection {
	const nodes = new Map<string, ProjectedNode>();
	for (const entry of review.subjects.values())
		nodes.set(entry.path, { ...entry, children: [...(entry.node?.children ?? [])], visible: false });
	const branches = new Set<string>();
	function display(entry: ProjectedNode) {
		const kinds = new Set<NonNullable<AnalysisWireNode["kind"]>>();
		const priorities: Importance[] = [];
		if (entry.node?.kind && entry.ownVisible) {
			kinds.add(entry.node.kind);
			priorities.push(importanceOf(entry.node));
		}
		for (const path of entry.children) {
			const child = nodes.get(path);
			if (!child) continue;
			const childKinds = display(child);
			if (child.shown.files > 0) {
				for (const kind of childKinds) kinds.add(kind);
				if (child.importance) priorities.push(child.importance);
			}
		}
		if (kinds.size === 1) entry.kind = [...kinds][0];
		const importance = (["high", "medium", "low", "none"] as Importance[]).find((value) => priorities.includes(value));
		if (importance) entry.importance = importance;
		entry.visible = entry.shown.files > 0;
		// Canonical branches survive filtering so manual expansion choices do too.
		if (entry.children.length) branches.add(entry.path);
		return kinds;
	}
	const root = nodes.get(".");
	if (root) display(root);
	return { ...(root ? { root } : {}), nodes, branches, all: review.all, visible: review.visible };
}

export function expansionVisibleSummary(projection: TreeProjection, expanded: ReadonlySet<string>) {
	function* entries(entry: ProjectedNode): Generator<AnalysisWireNode> {
		if (!entry.visible) return;
		if (entry.ownVisible && entry.node) yield entry.node;
		if (!expanded.has(entry.path)) return;
		for (const path of entry.children) {
			const child = projection.nodes.get(path);
			if (child) yield* entries(child);
		}
	}
	return summarizeEntries(projection.root ? entries(projection.root) : []);
}
