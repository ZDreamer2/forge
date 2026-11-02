import type { WorkspaceTree } from "./tree.ts";
import type {
	AnalysisHandlerIdentity,
	AnalysisNode,
	AnalysisSide,
	AnalysisSignal,
	AnalysisTree,
	Classification,
	ClassificationNode,
	CodebaseFacts,
	Emphasis,
	ExplicitEmphasis,
	SignalLocation,
	TreeNode,
	TreeSide,
} from "./types.ts";

export function codebaseFacts(owner: CodebaseFacts): CodebaseFacts {
	return {
		id: owner.id,
		root: owner.root,
		guide: owner.guide,
	};
}
function sideFacts(side: TreeSide | undefined): AnalysisSide | undefined {
	if (!side) return undefined;
	const { codebase, codebaseRoot, ...facts } = side;
	return {
		...facts,
		...(codebase ? { codebase: codebaseFacts(codebase) } : {}),
		...(codebaseRoot ? { codebaseRoot: codebaseFacts(codebaseRoot) } : {}),
	};
}
function nodeFacts(fact: TreeNode): ClassificationNode {
	const { base, current, statistics, ...facts } = fact;
	const oldSide = sideFacts(base);
	const newSide = sideFacts(current);
	return {
		...facts,
		...(oldSide ? { base: oldSide } : {}),
		...(newSide ? { current: newSide } : {}),
		...(statistics ? { statistics: { ...statistics } } : {}),
	};
}
export interface AnalysisTreeDeps {
	readonly currentHandler: () => AnalysisHandlerIdentity;
	readonly checkActive: () => void;
}
export function createAnalysisTree(base: WorkspaceTree, deps: AnalysisTreeDeps): AnalysisTree {
	const nodes = new Map<string, AnalysisNode>();
	const childLists = new Map<string, AnalysisNode[]>();
	const states = new Map<
		AnalysisNode,
		{
			facts: ClassificationNode;
			assign: (value: Classification) => void;
		}
	>();
	for (const fact of base.nodes.values()) {
		deps.checkActive();
		let emphasis: ExplicitEmphasis | undefined;
		let classification: Classification = { value: "code" };
		const signals: AnalysisSignal[] = [];
		const children: AnalysisNode[] = [];
		const setEmphasis = (value: Emphasis, reason: string) => {
			deps.checkActive();
			emphasis = { value, reason, handler: deps.currentHandler() };
		};
		const signal = (severity: AnalysisSignal["severity"], message: string, location?: SignalLocation) => {
			deps.checkActive();
			signals.push({
				severity,
				message,
				handler: deps.currentHandler(),
				...(location ? { location: { ...location } } : {}),
			});
		};
		// Both hook views start from canonical facts; annotation capabilities never
		// enter the classifier view, including capabilities added in the future.
		const facts = nodeFacts(fact);
		const node: AnalysisNode = {
			...facts,
			get parent() {
				return fact.path === "."
					? undefined
					: nodes.get(fact.path.includes("/") ? fact.path.slice(0, fact.path.lastIndexOf("/")) : ".");
			},
			children,
			get classification() {
				return classification;
			},
			get emphasis() {
				return emphasis;
			},
			signals,
			*walk() {
				const stack: AnalysisNode[] = [this];
				while (stack.length) {
					deps.checkActive();
					const next = stack.pop();
					if (!next) break;
					yield next;
					for (let i = next.children.length - 1; i >= 0; i--) {
						const child = next.children[i];
						if (child) stack.push(child);
					}
				}
			},
			deemphasize: (reason) => setEmphasis("deemphasized", reason),
			restoreNormalEmphasis: (reason = "Restore normal attention") => setEmphasis("normal", reason),
			emphasize: (reason) => setEmphasis("emphasized", reason),
			hide: (reason) => setEmphasis("hidden", reason),
			warn: (message, location) => signal("warning", message, location),
			notice: (message, location) => signal("notice", message, location),
		};
		states.set(node, {
			facts,
			assign: (value) => {
				classification = value;
			},
		});
		nodes.set(node.path, node);
		childLists.set(node.path, children);
	}
	for (const node of nodes.values()) if (node.parent) childLists.get(node.parent.path)?.push(node);
	for (const children of childLists.values())
		children.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
	const root = nodes.get(".");
	if (!root) throw new TypeError("Workspace tree requires its root");
	return {
		root,
		nodes,
		classificationFacts(node) {
			deps.checkActive();
			const state = states.get(node);
			if (!state) throw new TypeError("Classification target must belong to this run");
			return state.facts;
		},
		classify(node, value, reason) {
			deps.checkActive();
			if (!["code", "tests", "docs", "config", "assets"].includes(value))
				throw new TypeError("Invalid classification value");
			const state = states.get(node);
			if (!state) throw new TypeError("Classification target must belong to this run");
			state.assign({ value, ...(reason === undefined ? {} : { reason }), handler: deps.currentHandler() });
		},
	};
}
