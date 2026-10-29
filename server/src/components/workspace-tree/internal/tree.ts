import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { lineTotals } from "./totals.ts";
import type { NodeKind, TreeContext, TreeEntry, TreeEntryNode, TreeNode, TreeSide } from "./types.ts";

function inside(root: string, path: string): boolean {
	const offset = relative(root, path);
	return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

function validPath(path: string): void {
	if (path === ".") return;
	if (!path || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
		throw new TypeError("Tree paths must be normalized workspace-relative paths");
	}
}

type StoredNode = Omit<TreeNode, "base" | "current"> & { base?: TreeSide; current?: TreeSide };
type StoredEntryNode = StoredNode & { readonly repo: string };

/** Request-local path data; all ownership comes from the supplied startup context. */
export class WorkspaceTree {
	private readonly nodeMap = new Map<string, StoredNode>();
	private readonly entryList: StoredEntryNode[] = [];
	readonly context: TreeContext;
	private readonly inserted = new Set<string>();

	get nodes(): ReadonlyMap<string, TreeNode> {
		return this.nodeMap;
	}

	get entries(): readonly TreeEntryNode[] {
		return this.entryList;
	}

	constructor(context: TreeContext) {
		this.context = {
			root: resolve(context.root),
			codebases: context.codebases.map((codebase) => ({ ...codebase })),
			repositories: context.repositories.map((repository) => ({ ...repository })),
		};
		this.nodeMap.set(".", { path: ".", base: this.side(".", "directory"), current: this.side(".", "directory") });
	}

	private side(path: string, kind: NodeKind): TreeSide {
		const absolute = resolve(this.context.root, path);
		const codebase = [...this.context.codebases]
			.sort((a, b) => b.root.split(sep).length - a.root.split(sep).length)
			.find((item) => inside(item.root, absolute));
		const repository = [...this.context.repositories]
			.sort((a, b) => b.path.split("/").length - a.path.split("/").length || (a.path === "." ? 1 : -1))
			.find((item) => inside(resolve(this.context.root, item.path), absolute));
		return {
			path,
			kind,
			...(repository === undefined ? {} : { repository: repository.path }),
			...(codebase === undefined ? {} : { codebase }),
			...(kind === "directory" && repository && resolve(this.context.root, repository.path) === absolute
				? { repositoryRoot: repository.path }
				: {}),
			...(kind === "directory" && codebase?.root === absolute ? { codebaseRoot: codebase } : {}),
		};
	}

	private ancestors(path: string, version: "base" | "current"): void {
		let parent = posix.dirname(path);
		while (parent !== ".") {
			let node = this.nodeMap.get(parent);
			if (!node) {
				node = { path: parent };
				this.nodeMap.set(parent, node);
			}
			node[version] ??= this.side(parent, "directory");
			parent = posix.dirname(parent);
		}
	}

	insert(entry: TreeEntry): TreeEntryNode {
		validPath(entry.path);
		if (entry.from !== undefined) validPath(entry.from);
		if (entry.path === "." || this.inserted.has(entry.path)) throw new TypeError(`Duplicate tree entry: ${entry.path}`);
		if (!entry.base && !entry.current) throw new TypeError("Tree entries require a present side");
		if ((entry.kind === "renamed") !== (entry.from !== undefined))
			throw new TypeError("Only rename entries carry a previous path");
		if (
			entry.statistics &&
			(!Number.isSafeInteger(entry.statistics.added) ||
				entry.statistics.added < 0 ||
				!Number.isSafeInteger(entry.statistics.removed) ||
				entry.statistics.removed < 0)
		) {
			throw new TypeError("Line statistics must be nonnegative safe integers");
		}
		const node: StoredEntryNode = {
			path: entry.path,
			repo: entry.repo,
			...(entry.kind === undefined ? {} : { kind: entry.kind }),
			...(entry.from === undefined ? {} : { from: entry.from }),
			...(entry.kind === "renamed" && entry.renameContentChanged !== undefined
				? { renameContentChanged: entry.renameContentChanged }
				: {}),
			...(entry.base === undefined ? {} : { base: this.side(entry.from ?? entry.path, entry.base.kind) }),
			...(entry.current === undefined ? {} : { current: this.side(entry.path, entry.current.kind) }),
			...(entry.statistics === undefined ? {} : { statistics: { ...entry.statistics } }),
		};
		// Existing inferred directory sides preserve file/directory transitions with descendants.
		const previous = this.nodeMap.get(entry.path);
		if (previous?.base && !node.base) node.base = previous.base;
		if (previous?.current && !node.current) node.current = previous.current;
		this.nodeMap.set(entry.path, node);
		this.inserted.add(entry.path);
		this.entryList.push(node);
		if (entry.base) this.ancestors(entry.from ?? entry.path, "base");
		if (entry.current) this.ancestors(entry.path, "current");
		return node;
	}

	totals(path = ".") {
		validPath(path);
		return lineTotals(this.entries, path);
	}
}

export function createWorkspaceTree(context: TreeContext): WorkspaceTree {
	return new WorkspaceTree(context);
}
