import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { type GitProcess, gitFailure, preflightRepository } from "../../../../../lib/git/index.ts";
import type { ResolvedCodebase } from "../../../../workspace-config/index.ts";
import {
	createScope,
	inside,
	type RepositoryResolution,
	repositoryExclusions,
} from "../../../../workspace-repositories/index.ts";
import {
	createWorkspaceTree,
	type TreeEntry,
	type TreeNode,
	type WorkspaceTree,
} from "../../../../workspace-tree/index.ts";
import { compare } from "./comparison.ts";
import { line } from "./comparison-records.ts";
import { createCurrentFileSize } from "./current-file-size.ts";
import type { Descriptor } from "./file-diff.ts";
import { createFileDiff } from "./file-diff.ts";

interface Deps {
	readonly root: string;
	readonly repositories: readonly RepositoryResolution[];
	readonly codebases: readonly ResolvedCodebase[];
	readonly git: GitProcess;
}

function side(mode: string): { kind: "file" | "symlink" | "directory" } | undefined {
	return mode === "000000"
		? undefined
		: { kind: mode === "120000" ? "symlink" : mode === "040000" ? "directory" : "file" };
}

export function createWorkingChanges(deps: Deps) {
	const repositories = deps.repositories.map((repository) => ({ ...repository }));
	const root = resolve(deps.root);
	const collectedTrees = new WeakMap<WorkspaceTree, ReadonlySet<TreeNode>>();
	const descriptors = new WeakMap<WorkspaceTree, ReadonlyMap<string, Descriptor>>();

	const fileDiff = createFileDiff({ ...deps, root, repositories, descriptors });
	const currentByteSize = createCurrentFileSize({ ...deps, root, repositories, collectedTrees });
	return {
		currentByteSize,
		fileDiff,
		async collect(signal?: AbortSignal): Promise<WorkspaceTree> {
			if ((await realpath(root)) !== root) throw new Error("Workspace location changed");

			const pending = new Map<string, Descriptor>();
			const collected: TreeEntry[][] = new Array(repositories.length);
			const controller = new AbortController();
			signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
			let firstFailure: Error | undefined;
			let cursor = 0;

			async function lane() {
				while (cursor < repositories.length) {
					const number = cursor++;
					const repository = repositories[number];
					if (!repository) continue;
					signal?.throwIfAborted();
					if (repository.status === "missing") continue;
					try {
						const location = resolve(root, repository.path);
						const participantRoot = await realpath(location);
						if (!inside(root, participantRoot) || !(await lstat(participantRoot)).isDirectory()) {
							throw new Error("Participating repository location changed");
						}
						const probe = await deps.git(
							participantRoot,
							["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-path", "objects"],
							{ signal },
						);
						if (probe.code !== 0) throw gitFailure("rev-parse", probe);
						// Frame with the known root: splitting lines would corrupt newline-bearing roots.
						const prefix = Buffer.from(`${repository.gitRoot}\n`);
						if (!probe.stdout.subarray(0, prefix.length).equals(prefix))
							throw new Error("Participating repository Git root changed");
						const gitRoot = await realpath(repository.gitRoot);
						const objectPath = line(probe.stdout.subarray(prefix.length));
						if (
							gitRoot !== repository.gitRoot ||
							!inside(gitRoot, participantRoot) ||
							(repository.path !== "." && gitRoot !== participantRoot)
						) {
							throw new Error("Participating repository Git root changed");
						}
						await preflightRepository(deps.git, gitRoot, signal, objectPath);
						const exclusions = repositoryExclusions(root, repository.path, participantRoot, repositories);
						const pathspec = (path: string) => relative(gitRoot, path).split(sep).join("/");
						const scope = [
							"--",
							`:(top,literal)${pathspec(participantRoot)}`,
							...new Set(exclusions.map((path) => `:(top,exclude,literal)${pathspec(path)}`)),
						];
						const inScope = createScope(gitRoot, root, participantRoot, exclusions);
						const parsed = await compare(deps.git, gitRoot, scope, inScope, signal);
						const publishedPath = (path: string) =>
							repository.path === "."
								? relative(root, resolve(gitRoot, path)).split(sep).join("/")
								: `${repository.path}/${path}`;
						parsed.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
						const entries = parsed.map((item) => {
							pending.set(publishedPath(item.path), { repository, change: item });
							const change: TreeEntry = {
								repo: repository.path,
								path: publishedPath(item.path),
								kind: item.kind,
								...(side(item.oldMode) ? { base: side(item.oldMode) } : {}),
								...(side(item.newMode) ? { current: side(item.newMode) } : {}),
								statistics: item.statistics,
								...(item.from === undefined
									? {}
									: { from: publishedPath(item.from), renameContentChanged: item.renameContentChanged }),
							};
							return change;
						});
						entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
						collected[number] = entries;
					} catch (cause) {
						const error = new Error(`Change collection failed for repository ${repository.path}`, { cause });
						firstFailure ??= error;
						controller.abort(error);
						throw error;
					}
				}
			}
			// Join both lanes so failed collections cannot leave a peer's Git/filter work alive.
			const settled = await Promise.allSettled([lane(), lane()]);
			const failed = settled.find((result) => result.status === "rejected");
			if (failed?.status === "rejected") throw firstFailure ?? failed.reason;
			signal.throwIfAborted();

			const tree = createWorkspaceTree({
				root,
				repositories: repositories.filter((item) => item.status === "available"),
				codebases: deps.codebases,
			});
			for (const batch of collected) for (const entry of batch ?? []) tree.insert(entry);
			descriptors.set(tree, pending);
			collectedTrees.set(tree, new Set(tree.entries));
			return tree;
		},
	};
}
