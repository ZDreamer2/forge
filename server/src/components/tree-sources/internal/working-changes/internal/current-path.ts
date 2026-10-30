import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { type GitProcess, gitFailure } from "../../../../../lib/git/index.ts";
import { inside, type RepositoryResolution, repositoryExclusions } from "../../../../workspace-repositories/index.ts";

function absent(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
interface Deps {
	readonly root: string;
	readonly repositories: readonly RepositoryResolution[];
	readonly git: GitProcess;
}
export function createCurrentPath(deps: Deps) {
	return async (
		repository: Extract<RepositoryResolution, { status: "available" }>,
		path: string,
		signal?: AbortSignal,
	) => {
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
		const target = resolve(deps.root, path);
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
		return { target, stat: await observe(target) };
	};
}
