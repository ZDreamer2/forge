import { resolve } from "node:path";
import { type GitProcess, gitFailure } from "./process.ts";
import { type IndexEntry, withScratchIndex } from "./scratch-index.ts";

export async function compareIndexEntries(
	git: GitProcess,
	root: string,
	entries: readonly IndexEntry[],
	signal?: AbortSignal,
): Promise<Buffer> {
	return withScratchIndex(git, root, entries, signal, async (scratch) => {
		const result = await scratch(
			root,
			[
				"diff-files",
				"--raw",
				"--numstat",
				"-z",
				"--no-abbrev",
				"--no-ext-diff",
				"--no-textconv",
				"--ignore-submodules=all",
			],
			{ signal },
		);
		if (result.code !== 0) throw gitFailure("working pair comparison", result);
		return result.stdout;
	});
}

export async function deletedPairStatistics(
	git: GitProcess,
	root: string,
	baseline: string,
	paths: readonly string[],
	signal?: AbortSignal,
): Promise<Buffer> {
	return withScratchIndex(git, root, [], signal, async (scratch) => {
		const result = await scratch(
			root,
			[
				"diff",
				"--cached",
				"--numstat",
				"-z",
				"--no-ext-diff",
				"--no-textconv",
				baseline,
				"--",
				...paths.map((path) => `:(top,literal)${path}`),
			],
			{ signal },
		);
		if (result.code !== 0) throw gitFailure("deletion statistics", result);
		return result.stdout;
	});
}

export async function addedPairStatistics(
	git: GitProcess,
	root: string,
	path: string,
	signal?: AbortSignal,
): Promise<Buffer> {
	const result = await git(
		root,
		["diff", "--no-index", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "--", "/dev/null", resolve(root, path)],
		{ signal },
	);
	if (result.code !== 0 && result.code !== 1) throw gitFailure("addition statistics", result);
	return result.stdout;
}
