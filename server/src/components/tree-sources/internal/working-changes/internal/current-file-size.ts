import type { GitProcess } from "../../../../../lib/git/index.ts";
import type { RepositoryResolution } from "../../../../workspace-repositories/index.ts";
import type { TreeNode, WorkspaceTree } from "../../../../workspace-tree/index.ts";
import { createCurrentPath } from "./current-path.ts";

interface Deps {
	readonly root: string;
	readonly repositories: readonly RepositoryResolution[];
	readonly git: GitProcess;
	readonly collectedTrees: WeakMap<WorkspaceTree, ReadonlySet<TreeNode>>;
}

/** Metadata-only observations use stricter traversal than collection's historical-path scope. */
export function createCurrentFileSize(deps: Deps) {
	return async (tree: WorkspaceTree, node: TreeNode, signal?: AbortSignal): Promise<number> => {
		signal?.throwIfAborted();
		if (
			!deps.collectedTrees.get(tree)?.has(node) ||
			tree.nodes.get(node.path) !== node ||
			!node.repo ||
			node.current?.kind !== "file" ||
			node.current.repository !== node.repo
		)
			throw new Error("Size requires a current regular file from this source");
		const repository = deps.repositories.find((item) => item.path === node.repo);
		if (repository?.status !== "available") throw new Error("File has no participating repository");
		const { stat } = await createCurrentPath(deps)(repository, node.path, signal);
		if (!stat.isFile()) throw new Error("Current file is no longer a regular file");
		return stat.size;
	};
}
