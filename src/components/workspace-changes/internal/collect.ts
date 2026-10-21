import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { type GitProcess, gitFailure, preflightRepository } from "../../../lib/git/index.ts";
import type {
	CodebaseContext,
	RepositoryResolution,
	WorkspaceChange,
	WorkspacePolicy,
} from "../../workspace-policy/index.ts";
import { createScope, inside } from "./boundaries.ts";
import { type ComparedChange, compare, line } from "./comparison.ts";
import type { CollectedChange, CollectedWorkspaceChanges } from "./types.ts";

interface Deps {
	readonly root: string;
	readonly repositories: readonly RepositoryResolution[];
	readonly codebasesForChange: WorkspacePolicy["codebasesForChange"];
	readonly git: GitProcess;
}

function memberships(value: unknown): readonly CodebaseContext[] {
	if (!Array.isArray(value)) throw new TypeError("Policy memberships must be an array");
	return Array.from(value, (item: unknown) => {
		if (
			item === null ||
			typeof item !== "object" ||
			!("id" in item) ||
			!("guidance" in item) ||
			typeof item.id !== "string" ||
			item.id.trim().length === 0 ||
			typeof item.guidance !== "string" ||
			item.guidance.trim().length === 0
		) {
			throw new TypeError("Policy memberships need nonempty id and guidance strings");
		}
		return { id: item.id, guidance: item.guidance };
	});
}

export function createWorkspaceChanges(deps: Deps) {
	const repositories = deps.repositories.map((repository) => ({ ...repository }));
	const root = resolve(deps.root);
	return {
		async collect(signal?: AbortSignal): Promise<CollectedWorkspaceChanges> {
			if ((await realpath(root)) !== root) throw new Error("Workspace location changed");
			const changes: CollectedChange[] = [];
			const collected: WorkspaceChange[][] = new Array(repositories.length);
			const controller = new AbortController();
			signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
			let firstFailure: Error | undefined;
			let cursor = 0;
			const definitions = new Map<string, { guidance: string }>();
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
						const exclusions = repositories.flatMap((item, index) => {
							if (index === number) return [];
							const logical = resolve(root, item.path);
							const paths = [logical];
							// Missing descendants have no canonical Git root; map them through a parent alias.
							if (logical !== location && inside(location, logical)) {
								paths.push(resolve(participantRoot, relative(location, logical)));
							}
							if (item.path !== "." && item.status === "available") paths.push(item.gitRoot);
							return paths.filter((path) => path !== participantRoot && inside(participantRoot, path));
						});
						const pathspec = (path: string) => relative(gitRoot, path).split(sep).join("/");
						const scope = [
							"--",
							`:(top,literal)${pathspec(participantRoot)}`,
							...new Set(exclusions.map((path) => `:(top,exclude,literal)${pathspec(path)}`)),
						];
						const inScope = createScope(gitRoot, root, participantRoot, exclusions);
						const parsed = await compare(deps.git, gitRoot, scope, inScope, signal);
						const scoped: ComparedChange[] = [];
						for (const item of parsed) {
							signal?.throwIfAborted();
							const destination = await inScope(item.path);
							if (item.from === undefined) {
								if (destination) scoped.push(item);
							} else {
								const source = await inScope(item.from);
								if (destination && source) scoped.push(item);
								else if (destination) scoped.push({ path: item.path, kind: "added" });
								else if (source && item.kind === "renamed") scoped.push({ path: item.from, kind: "deleted" });
							}
						}
						const publishedPath = (path: string) =>
							repository.path === "."
								? relative(root, resolve(gitRoot, path)).split(sep).join("/")
								: `${repository.path}/${path}`;
						scoped.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
						const entries = scoped.map((item) => {
							const change: WorkspaceChange = {
								repo: repository.path,
								path: publishedPath(item.path),
								kind: item.kind,
								...(item.from === undefined ? {} : { from: publishedPath(item.from) }),
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
			// Policy is synchronous and observes declaration order, independent of completion order.
			for (const batch of collected)
				for (const change of batch ?? []) {
					try {
						const ids = new Set<string>();
						for (const { id, guidance } of memberships(deps.codebasesForChange(change))) {
							const previous = definitions.get(id);
							if (previous && previous.guidance !== guidance)
								throw new Error(`Conflicting guidance for codebase ${id}`);
							definitions.set(id, { guidance });
							ids.add(id);
						}
						changes.push({ ...change, codebases: [...ids] });
					} catch (cause) {
						throw new Error(`Change collection failed for repository ${change.repo}`, { cause });
					}
				}
			return { codebases: Object.fromEntries(definitions), changes };
		},
	};
}
