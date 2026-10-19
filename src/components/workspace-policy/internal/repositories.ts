import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { RepositoryDeclaration } from "./types.ts";

const execute = promisify(execFile);

export function validRepositoryPath(path: string): boolean {
	return (
		path === "." ||
		(path.length > 0 &&
			!path.includes("\\") &&
			!path.includes(":") &&
			!path.includes("\0") &&
			path.split("/").every((part) => part !== "" && part !== "." && part !== ".."))
	);
}

export type RepositoryResolution =
	| { readonly path: string; readonly status: "available"; readonly gitRoot: string }
	| { readonly path: string; readonly status: "missing" };

/** Explicit startup/reload probe, never a recursive scan or change-list poll. */
export async function resolveRepositories(
	workspaceRoot: string,
	declarations: readonly RepositoryDeclaration[],
): Promise<readonly RepositoryResolution[]> {
	const root = await realpath(workspaceRoot);
	const results: RepositoryResolution[] = [];
	const seen = new Set<string>();
	for (const declaration of declarations) {
		const path = declaration.path;
		if (!validRepositoryPath(path) || seen.has(path)) {
			throw new TypeError("Repository declarations need unique normalized workspace-relative paths");
		}
		seen.add(path);
		const location = resolve(root, path);
		try {
			if (!(await stat(location)).isDirectory()) {
				throw new Error(`Declared repository is not a directory: ${path}`);
			}
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				results.push({ path, status: "missing" });
				continue;
			}
			throw error;
		}
		const directory = await realpath(location);
		const within = relative(root, directory);
		if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) {
			throw new Error(`Declared repository escapes workspace root: ${path}`);
		}
		const { stdout } = await execute("git", ["-C", directory, "rev-parse", "--show-toplevel"]);
		const gitRoot = await realpath(stdout.trim());
		// '.' intentionally permits a Git root above the selected workspace.
		if (path !== "." && gitRoot !== directory) {
			throw new Error(`Declared nested repository resolves to another Git root: ${path}`);
		}
		results.push({ path, status: "available", gitRoot });
	}
	return results;
}
