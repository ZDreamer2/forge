import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { validPath } from "./comparison.ts";

export function inside(root: string, path: string): boolean {
	const offset = relative(root, path);
	return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

function absent(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
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
		validPath(path);
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
