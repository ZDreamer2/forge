import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { type GitProcess, gitFailure } from "../../../../../lib/git/index.ts";
import { inside, type RepositoryResolution, repositoryExclusions } from "../../../../workspace-repositories/index.ts";
import type { TreeNode, WorkspaceTree } from "../../../../workspace-tree/index.ts";

interface Deps {
	readonly root: string;
	readonly repositories: readonly RepositoryResolution[];
	readonly git: GitProcess;
	readonly collectedTrees: WeakMap<WorkspaceTree, ReadonlySet<TreeNode>>;
}

function absent(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
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
		const observe = async (path: string) => {
			signal?.throwIfAborted();
			const stat = await lstat(path);
			signal?.throwIfAborted();
			return stat;
		};
		const canonical = async (path: string) => {
			signal?.throwIfAborted();
			const result = await realpath(path);
			signal?.throwIfAborted();
			return result;
		};
		if ((await canonical(deps.root)) !== deps.root || !(await observe(deps.root)).isDirectory())
			throw new Error("Workspace location changed");
		signal?.throwIfAborted();
		const participant = resolve(deps.root, repository.path);
		const target = resolve(deps.root, node.path);
		if (!inside(deps.root, target) || !inside(participant, target) || target === participant)
			throw new Error("File is outside source bounds");
		const parts = relative(deps.root, target).split(sep);
		if (parts.some((part) => !part || part === ".." || part === "." || part.toLowerCase() === ".git"))
			throw new Error("File is outside source bounds");
		const exclusions = repositoryExclusions(deps.root, repository.path, participant, deps.repositories);
		if (exclusions.some((path) => inside(path, target))) throw new Error("File crosses a repository boundary");
		let current = deps.root;
		for (const part of parts.slice(0, -1)) {
			current = resolve(current, part);
			if (!(await observe(current)).isDirectory()) throw new Error("File ancestor is not an ordinary directory");
			if (inside(participant, current) && current !== participant) {
				try {
					await observe(resolve(current, ".git"));
				} catch (error) {
					if (absent(error)) continue;
					throw error;
				}
				throw new Error("File crosses an undeclared repository boundary");
			}
		}
		if ((await canonical(participant)) !== participant || (await canonical(repository.gitRoot)) !== repository.gitRoot)
			throw new Error("Participating repository location changed");
		signal?.throwIfAborted();
		const probe = await deps.git(participant, ["rev-parse", "--path-format=absolute", "--show-toplevel"], { signal });
		signal?.throwIfAborted();
		if (probe.code !== 0) throw gitFailure("size repository identity", probe);
		if (!probe.stdout.equals(Buffer.from(`${repository.gitRoot}\n`)))
			throw new Error("Participating repository Git root changed");
		const stat = await observe(target);
		if (!stat.isFile()) throw new Error("Current file is no longer a regular file");
		return stat.size;
	};
}
