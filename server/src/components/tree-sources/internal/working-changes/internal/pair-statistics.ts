import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import {
	addedPairStatistics,
	compareIndexEntries,
	deletedPairStatistics,
	type GitProcess,
	gitFailure,
	type IndexEntry,
} from "../../../../../lib/git/index.ts";
import { parseComparison, records } from "./comparison-records.ts";
import type { ComparedChange, ReconciledChange } from "./types.ts";

function statistics(bytes: Buffer): ComparedChange["statistics"] {
	const fields = records(bytes);
	if (!fields.length) return { added: 0, removed: 0, binary: false };
	const match = /^(\d+|-)\t(\d+|-)\t/.exec(fields[0] ?? "");
	if (!match || (match[1] === "-") !== (match[2] === "-")) throw new Error("Invalid pair numstat");
	return {
		added: match[1] === "-" ? 0 : Number(match[1]),
		removed: match[2] === "-" ? 0 : Number(match[2]),
		binary: match[1] === "-",
	};
}

export async function wholeAddition(
	git: GitProcess,
	root: string,
	path: string,
	signal?: AbortSignal,
	effectiveMode?: string,
): Promise<ReconciledChange> {
	const stat = await lstat(resolve(root, path));
	return {
		path,
		kind: "added",
		comparison: { kind: "whole-addition" },
		oldMode: "000000",
		newMode:
			effectiveMode && effectiveMode !== "000000"
				? effectiveMode
				: stat.isSymbolicLink()
					? "120000"
					: stat.isDirectory()
						? "040000"
						: stat.mode & 0o100
							? "100755"
							: "100644",
		statistics: statistics(await addedPairStatistics(git, root, path, signal)),
	};
}

export async function wholeDeletion(
	git: GitProcess,
	root: string,
	baseline: string,
	path: string,
	oldMode: string,
	signal?: AbortSignal,
): Promise<ReconciledChange> {
	return {
		path,
		kind: "deleted",
		comparison: { kind: "scratch-index", entries: [] },
		oldMode,
		newMode: "000000",
		statistics: statistics(await deletedPairStatistics(git, root, baseline, [path], signal)),
	};
}

export async function correctPairs(
	git: GitProcess,
	root: string,
	baseline: string,
	input: readonly ComparedChange[],
	untracked: Set<string>,
	signal?: AbortSignal,
): Promise<ReconciledChange[]> {
	let changes: ReconciledChange[] = [];
	for (const item of input) {
		if (item.from !== undefined && untracked.has(item.from)) {
			changes.push(await wholeDeletion(git, root, baseline, item.from, item.oldMode, signal));
			changes.push(await wholeAddition(git, root, item.path, signal, item.newMode));
		} else if (item.correction === "addition")
			changes.push(await wholeAddition(git, root, item.path, signal, item.newMode));
		else if (item.correction === "deletion")
			changes.push(await wholeDeletion(git, root, baseline, item.path, item.oldMode, signal));
		else {
			const { correction: _correction, ...facts } = item;
			changes.push({ ...facts, comparison: { kind: "source-index" } });
		}
	}
	const ambiguous = changes.filter((item) => item.kind === "deleted" && untracked.has(item.path));
	const entries: IndexEntry[] = [];
	for (let start = 0; start < ambiguous.length; start += 100) {
		const result = await git(
			root,
			[
				"ls-tree",
				"-z",
				baseline,
				"--",
				...ambiguous.slice(start, start + 100).map(({ path }) => `:(top,literal)${path}`),
			],
			{ signal },
		);
		if (result.code !== 0) throw gitFailure("HEAD reconciliation", result);
		for (const record of records(result.stdout)) {
			const match = /^([0-7]{6}) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
			if (!match) throw new Error("Invalid HEAD reconciliation entry");
			const path = match[3] as string;
			try {
				const stat = await lstat(resolve(root, path));
				if (stat.isFile() || stat.isSymbolicLink())
					entries.push({ path, mode: match[1] as string, oid: match[2] as string });
			} catch (error) {
				if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
					untracked.delete(path);
				else throw error;
			}
		}
	}
	if (entries.length) {
		const replacements = parseComparison(await compareIndexEntries(git, root, entries, signal));
		const paths = new Set(entries.map(({ path }) => path));
		changes = changes.filter(({ path, kind }) => !(kind === "deleted" && paths.has(path)));
		// Reconciliation may include recreated ancestor attributes as well as this file.
		// Retain that shared index metadata so later patches use the identical fallback.
		changes.push(
			...replacements.map(
				({ correction: _correction, ...facts }): ReconciledChange => ({
					...facts,
					comparison: { kind: "scratch-index", entries },
				}),
			),
		);
		for (const path of paths) untracked.delete(path);
	}
	return changes;
}
