import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { RepositoryResolution } from "./types.ts";

export function inside(root: string, path: string): boolean {
	const offset = relative(root, path);
	return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

function absent(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** Declared children stay separate even when missing or reached through a repository alias. */
export function repositoryExclusions(
	workspaceRoot: string,
	participantPath: string,
	participantRoot: string,
	repositories: readonly RepositoryResolution[],
): readonly string[] {
	const location = resolve(workspaceRoot, participantPath);
	const exclusions = repositories.flatMap((repository) => {
		if (repository.path === participantPath) return [];
		const logical = resolve(workspaceRoot, repository.path);
		const paths = [logical];
		if (logical !== location && inside(location, logical)) {
			paths.push(resolve(participantRoot, relative(location, logical)));
		}
		if (repository.path !== "." && repository.status === "available") paths.push(repository.gitRoot);
		return paths.filter((path) => path !== participantRoot && inside(participantRoot, path));
	});
	return [...new Set(exclusions)];
}

/** Check only candidate ancestors; never traverse a nested repository or a symlink. */
export function createScope(
	repositoryRoot: string,
	workspaceRoot: string,
	participantRoot: string,
	exclusions: readonly string[],
) {
	const directories = new Map<string, "ordinary" | "boundary" | "stop">();
	return async (path: string): Promise<boolean> => {
		if (!path || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
			throw new Error("Invalid Git path");
		}
		if (path.split("/").some((part) => part.toLowerCase() === ".git")) return false;
		const absolute = resolve(repositoryRoot, path);
		if (!inside(workspaceRoot, absolute) || !inside(participantRoot, absolute)) return false;
		if (exclusions.some((root) => inside(root, absolute))) return false;
		let current = participantRoot;
		for (const part of relative(participantRoot, absolute).split(sep)) {
			current = resolve(current, part);
			let state = directories.get(current);
			if (state === undefined) {
				try {
					const stat = await lstat(current);
					state = stat.isDirectory() && !stat.isSymbolicLink() ? "ordinary" : "stop";
					if (state === "ordinary") {
						try {
							await lstat(resolve(current, ".git"));
							state = "boundary";
						} catch (error) {
							if (!absent(error)) throw error;
						}
					}
				} catch (error) {
					if (!absent(error)) throw error;
					state = "stop";
				}
				directories.set(current, state);
			}
			if (state === "boundary") return false;
			if (state === "stop") return true;
		}
		return true;
	};
}
