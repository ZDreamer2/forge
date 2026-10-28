import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type GitProcess, gitFailure } from "../../../lib/git/index.ts";
import { type RepositoryDeclaration, validRepositoryPath } from "../../workspace-config/index.ts";
import type { RepositoryResolution } from "./types.ts";

/** Explicit startup/reload probe, never a recursive scan or change-list poll. */
export async function resolveRepositories(
	workspaceRoot: string,
	declarations: readonly RepositoryDeclaration[],
	git: GitProcess,
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
		const result = await git(directory, ["rev-parse", "--show-toplevel"]);
		if (result.code !== 0) throw gitFailure(`repository probe (${path})`, result);
		if (result.stdout.at(-1) !== 10) throw new Error("Git returned an invalid repository root");
		const gitRoot = await realpath(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout.subarray(0, -1)));
		const fromGitRoot = relative(gitRoot, directory);
		if (isAbsolute(fromGitRoot) || fromGitRoot === ".." || fromGitRoot.startsWith(`..${sep}`)) {
			throw new Error(`Git root does not contain workspace: ${path}`);
		}
		// '.' intentionally permits a Git root above the selected workspace.
		if (path !== "." && gitRoot !== directory) {
			throw new Error(`Declared nested repository resolves to another Git root: ${path}`);
		}
		results.push({ path, status: "available", gitRoot });
	}
	return results;
}
