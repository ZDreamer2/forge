import { resolve } from "node:path";
import { rootedCodebases } from "./rooted-codebases.ts";
import {
	type GuideIdentity,
	type ResolvedCodebase,
	type ResolvedGuide,
	type ResolvedGuideChain,
	type RootedCodebase,
	type WorkspaceConfig,
	WorkspaceConfigError,
} from "./types.ts";

type Guide = ResolvedGuide;

export function guideIdentity(guide: Guide): GuideIdentity {
	return "id" in guide ? `codebase:${guide.id}` : "workspace";
}

export function findCodebaseRoot(registry: WorkspaceConfig, root: string): RootedCodebase | undefined {
	const lexical = resolve(root);
	return rootedCodebases(registry).find((guide) => guide.root === lexical);
}

function validateIds(registry: WorkspaceConfig): void {
	const ids = new Set<string>();
	for (const guide of registry.guides) {
		if (ids.has(guide.id)) throw new WorkspaceConfigError(`Duplicate codebase ID ${JSON.stringify(guide.id)}`);
		ids.add(guide.id);
	}
}

function label(guide: Guide): string {
	return "id" in guide ? `${JSON.stringify(guide.id)} (${guide.guide})` : `workspace (${guide.guide})`;
}

function topological(predecessors: Map<Guide, Set<Guide>>, priority: readonly Guide[], context: string): Guide[] {
	const emitted = new Set<Guide>();
	const result: Guide[] = [];
	while (result.length < predecessors.size) {
		const guide = priority.find(
			(candidate) =>
				!emitted.has(candidate) && [...(predecessors.get(candidate) ?? [])].every((before) => emitted.has(before)),
		);
		if (guide === undefined) {
			const constraints = priority
				.filter((after) => !emitted.has(after))
				.flatMap((after) =>
					priority
						.filter((before) => !emitted.has(before) && predecessors.get(after)?.has(before))
						.map((before) => `${label(before)} -> ${label(after)}`),
				);
			throw new WorkspaceConfigError(`Contradictory ordering in ${context}: ${constraints.join("; ")}`);
		}
		emitted.add(guide);
		result.push(guide);
	}
	return result;
}

function ancestry(registry: WorkspaceConfig, target: Guide): Guide[] {
	const predecessors = new Map<Guide, Set<Guide>>();
	const ancestors = new Map<Guide, Set<Guide>>();
	const parentsByGuide = new Map<Guide, ResolvedCodebase[]>();
	const active: Guide[] = [];
	const priority: Guide[] = [];
	function visit(guide: Guide): void {
		const cycleStart = active.indexOf(guide);
		if (cycleStart !== -1)
			throw new WorkspaceConfigError(`Ancestry cycle: ${[...active.slice(cycleStart), guide].map(label).join(" -> ")}`);
		if (ancestors.has(guide)) return;
		active.push(guide);
		const parents: ResolvedCodebase[] = [];
		const inherited = new Set<Guide>();
		for (const id of guide.parents) {
			const parent = registry.guides.find((candidate) => candidate.id === id);
			if (parent === undefined) {
				const details = registry.unavailable
					.filter((item) => item.id === id || item.id === undefined)
					.map((item) => `${item.marker}: ${item.reason}`)
					.join("; ");
				throw new WorkspaceConfigError(
					`${label(guide)} requires unavailable parent ${JSON.stringify(id)}; register an available forge-codebase.yaml with that id${details ? ` (${details})` : ""}`,
				);
			}
			visit(parent);
			parents.push(parent);
			for (const ancestor of ancestors.get(parent) ?? []) inherited.add(ancestor);
			inherited.add(parent);
		}
		active.pop();
		predecessors.set(guide, new Set(parents));
		parentsByGuide.set(guide, parents);
		ancestors.set(guide, inherited);
		priority.push(guide);
	}
	visit(target);
	// Only independent siblings inherit declaration order; their own ancestry wins.
	for (const parents of parentsByGuide.values()) {
		for (const [index, before] of parents.entries()) {
			for (const after of parents.slice(index + 1)) {
				if (!ancestors.get(after)?.has(before) && !ancestors.get(before)?.has(after))
					predecessors.get(after)?.add(before);
			}
		}
	}
	return topological(predecessors, priority, `ancestry of ${label(target)}`);
}

export function resolveWorkspaceChain(registry: WorkspaceConfig): ResolvedGuideChain<undefined> {
	validateIds(registry);
	return { selected: undefined, guides: ancestry(registry, registry.workspace) };
}

export function resolveGuideChain(
	registry: WorkspaceConfig,
	selected: RootedCodebase,
): ResolvedGuideChain<RootedCodebase> {
	validateIds(registry);
	if (!registry.guides.includes(selected) || selected.root === undefined)
		throw new WorkspaceConfigError(
			`Selected codebase ${JSON.stringify(selected.id)} must be an available registered rooted guide`,
		);
	return {
		selected,
		guides: mergeGuideSequences(
			[ancestry(registry, registry.workspace), ancestry(registry, selected)],
			"workspace/codebase chain merge",
		),
	};
}

export function resolveCodebaseChain(registry: WorkspaceConfig, selected: RootedCodebase): readonly Guide[] {
	validateIds(registry);
	if (!registry.guides.includes(selected) || selected.root === undefined)
		throw new WorkspaceConfigError(
			`Selected codebase ${JSON.stringify(selected.id)} must be an available registered rooted guide`,
		);
	return ancestry(registry, selected);
}

export function mergeGuideSequences(chains: readonly (readonly Guide[])[], context: string): readonly Guide[] {
	const canonical = new Map<GuideIdentity, Guide>();
	const predecessors = new Map<Guide, Set<Guide>>();
	const priority: Guide[] = [];
	for (const chain of chains) {
		let before: Guide | undefined;
		for (const candidate of chain) {
			const id = guideIdentity(candidate);
			let guide = canonical.get(id);
			if (guide === undefined) {
				guide = candidate;
				canonical.set(id, guide);
				predecessors.set(guide, new Set());
				priority.push(guide);
			}
			if (before !== undefined && before !== guide) predecessors.get(guide)?.add(before);
			before = guide;
		}
	}
	return topological(predecessors, priority, context);
}
