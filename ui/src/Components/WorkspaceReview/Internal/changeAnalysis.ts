import type { AnalysisWireNode, ClassificationValue, WorkspaceIdentity } from "@forge/api-contract";
import { isWorkspaceGuidanceRoot, type WorkspaceAnalysis } from "./guidance";

export const typeLabels = {
	code: "Code",
	tests: "Tests",
	docs: "Docs",
	config: "Config",
	assets: "Assets",
} as const;
export const importanceLabels = { high: "High", medium: "Medium", low: "Low", none: "None" } as const;
export type Importance = keyof typeof importanceLabels;
export type Filters = { types: ReadonlySet<ClassificationValue>; importance: ReadonlySet<Importance> };
type Lines = { added: number; removed: number };
export type MatrixCell = Lines & { files: number };
export type Summary = Lines & {
	files: number;
	matrix: Record<ClassificationValue, Record<Importance, MatrixCell>>;
};

// These are canonical subjects and count scopes, not rows: no display hierarchy,
// visibility, expansion or placeholder parenting belongs to the shared analysis.
export type ReviewSubject = {
	path: string;
	node?: AnalysisWireNode;
	repository?: WorkspaceIdentity["repositories"][number];
	ownVisible: boolean;
	total: Summary;
	shown: Summary;
};
export type ReviewAnalysis = {
	subjects: ReadonlyMap<string, ReviewSubject>;
	all: Summary;
	visible: Summary;
};

export function initialFilters(): Filters {
	return {
		types: new Set(Object.keys(typeLabels) as ClassificationValue[]),
		importance: new Set<Importance>(["high", "medium", "low"]),
	};
}

export function importanceOf(node: AnalysisWireNode): Importance {
	return { emphasized: "high", normal: "medium", deemphasized: "low", hidden: "none" }[
		node.effectiveEmphasis.value
	] as Importance;
}

function emptySummary(): Summary {
	return {
		files: 0,
		added: 0,
		removed: 0,
		matrix: { code: cells(), tests: cells(), docs: cells(), config: cells(), assets: cells() },
	};
}

function cells(): Record<Importance, MatrixCell> {
	return {
		high: { files: 0, added: 0, removed: 0 },
		medium: { files: 0, added: 0, removed: 0 },
		low: { files: 0, added: 0, removed: 0 },
		none: { files: 0, added: 0, removed: 0 },
	};
}

function addLines(target: Lines, source: Lines) {
	target.added += source.added;
	target.removed += source.removed;
}

function addSummary(target: Summary, source: Summary) {
	target.files += source.files;
	addLines(target, source);
	for (const type of Object.keys(typeLabels) as ClassificationValue[])
		for (const importance of Object.keys(importanceLabels) as Importance[]) {
			const cell = target.matrix[type][importance];
			const other = source.matrix[type][importance];
			cell.files += other.files;
			addLines(cell, other);
		}
}

function addEntry(target: Summary, node: AnalysisWireNode) {
	target.files += 1;
	const cell = target.matrix[node.classification.value][importanceOf(node)];
	cell.files += 1;
	if (!node.statistics || node.statistics.binary) return;
	addLines(target, node.statistics);
	addLines(cell, node.statistics);
}

export function summarizeEntries(nodes: Iterable<AnalysisWireNode>): Summary {
	const summary = emptySummary();
	for (const node of nodes) addEntry(summary, node);
	return summary;
}

function subject(path: string, node?: AnalysisWireNode): ReviewSubject {
	return { path, ...(node ? { node } : {}), ownVisible: false, total: emptySummary(), shown: emptySummary() };
}

export function resolveSelection(review: ReviewAnalysis, path: string | undefined): ReviewSubject | undefined {
	return path === undefined ? undefined : review.subjects.get(path);
}

export function analyzeChanges(
	analysis: WorkspaceAnalysis | undefined,
	identity: WorkspaceIdentity | undefined,
	filters: Filters,
): ReviewAnalysis {
	const subjects = new Map<string, ReviewSubject>();
	for (const node of Object.values(analysis?.nodes ?? {})) subjects.set(node.path, subject(node.path, node));
	// Root links can select unchanged guides without inventing tree nodes or ownership.
	if (analysis)
		for (const chain of [analysis.guidance.workspace, ...Object.values(analysis.guidance.codebases)]) {
			for (const guide of chain)
				if (guide.root !== undefined && isWorkspaceGuidanceRoot(guide.root) && !subjects.has(guide.root)) {
					subjects.set(guide.root, subject(guide.root));
				}
		}
	for (const repository of identity?.repositories ?? []) {
		const entry = subjects.get(repository.path) ?? subject(repository.path);
		entry.repository = repository;
		subjects.set(repository.path, entry);
	}
	if (!subjects.has(".") && identity) subjects.set(".", subject("."));
	const all = emptySummary();
	const visible = emptySummary();
	for (const entry of subjects.values()) {
		const node = entry.node;
		if (!node?.kind) continue;
		entry.ownVisible = filters.types.has(node.classification.value) && filters.importance.has(importanceOf(node));
		addEntry(all, node);
		addEntry(entry.total, node);
		if (entry.ownVisible) {
			addEntry(visible, node);
			addEntry(entry.shown, node);
		}
	}
	// Only own entries contribute. Inclusive server totals would double-count
	// transitions that have both their own change and changed descendants.
	function summarize(entry: ReviewSubject) {
		for (const path of entry.node?.children ?? []) {
			const child = subjects.get(path);
			if (!child) continue;
			summarize(child);
			addSummary(entry.total, child.total);
			addSummary(entry.shown, child.shown);
		}
	}
	const root = subjects.get(".");
	if (root) summarize(root);
	return { subjects, all, visible };
}
