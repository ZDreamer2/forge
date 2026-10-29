import { type GitProcess, gitFailure } from "../../../../../lib/git/index.ts";
import { line, parseComparison, records } from "./comparison-records.ts";
import { correctPairs, wholeAddition } from "./pair-statistics.ts";
import type { ComparedChange } from "./types.ts";

export async function compare(
	git: GitProcess,
	root: string,
	scope: readonly string[],
	inScope: (path: string) => Promise<boolean>,
	signal?: AbortSignal,
): Promise<ComparedChange[]> {
	const run = async (args: readonly string[], input?: Buffer) => {
		const result = await git(root, args, { signal, ...(input === undefined ? {} : { input }) });
		if (result.code !== 0) throw gitFailure(args[0] ?? "comparison", result);
		return result.stdout;
	};
	const untracked = new Set<string>();
	for (const record of records(
		await run(["ls-files", "--unmerged", "--others", "--exclude-standard", "-t", "-z", ...scope]),
	)) {
		if (record.startsWith("? ")) {
			const path = record.slice(2);
			if (!path.endsWith("/") && (await inScope(path))) untracked.add(path);
		} else {
			const tab = record.indexOf("\t");
			if (tab < 0 || !/^M [0-7]{6} [0-9a-f]+ [123]$/.test(record.slice(0, tab)))
				throw new Error("Invalid unmerged record");
			const path = record.slice(tab + 1);
			if (await inScope(path)) throw new Error(`Unresolved merge conflict: ${path.slice(0, 200)}`);
		}
	}
	const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { signal });
	let baseline: string;
	if (head.code === 0) baseline = line(head.stdout);
	else {
		const symbolic = await git(root, ["symbolic-ref", "--quiet", "HEAD"], { signal });
		if (symbolic.code !== 0) throw gitFailure("HEAD resolution", head);
		const ref = line(symbolic.stdout);
		if (!ref.startsWith("refs/heads/")) throw new Error("Invalid unborn HEAD reference");
		const exists = await git(root, ["show-ref", "--verify", "--quiet", ref], { signal });
		if (exists.code !== 1 || exists.stderr.length) throw gitFailure("HEAD resolution", head);
		baseline = line(await run(["hash-object", "-t", "tree", "--stdin"], Buffer.alloc(0)));
	}
	if (!/^[0-9a-f]{40,64}$/.test(baseline)) throw new Error("Invalid baseline object ID");
	let changes = parseComparison(
		await run([
			"diff",
			"--raw",
			"--numstat",
			"-z",
			"--no-abbrev",
			"--find-renames",
			"--no-ext-diff",
			"--no-textconv",
			"--ignore-submodules=all",
			baseline,
			...scope,
		]),
	);

	// Scope before exceptional comparisons: a containing Git root can report a
	// rename side outside the workspace, whose bytes this source must never read.
	const scoped: ComparedChange[] = [];
	for (const item of changes) {
		signal?.throwIfAborted();
		const destination = await inScope(item.path);
		if (item.from === undefined) {
			if (destination) scoped.push(item);
		} else {
			const source = await inScope(item.from);
			if (destination && source) scoped.push(item);
			else if (destination) {
				const { from: _from, renameContentChanged: _renameContentChanged, ...rest } = item;
				scoped.push({ ...rest, kind: "added", oldMode: "000000", correction: "addition" });
			} else if (source) {
				const { from: _from, renameContentChanged: _renameContentChanged, ...rest } = item;
				scoped.push({ ...rest, path: item.from, kind: "deleted", newMode: "000000", correction: "deletion" });
			}
		}
	}
	// HEAD bytes are already normalized; a scratch index compares the actual worktree
	// against those objects without feeding the baseline through a clean filter again.
	changes = await correctPairs(git, root, baseline, scoped, untracked, signal);
	for (const path of untracked) changes.push(await wholeAddition(git, root, path, signal));
	return changes;
}
