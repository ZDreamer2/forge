import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { type GitProcess, gitFailure } from "../../../lib/git/index.ts";
import type { WorkspaceChange } from "../../workspace-policy/index.ts";

export interface ComparedChange {
	readonly path: string;
	readonly kind: WorkspaceChange["kind"];
	readonly from?: string;
}

export function decode(bytes: Buffer): string {
	return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function line(bytes: Buffer): string {
	if (bytes.at(-1) !== 10) throw new Error("Git returned a truncated line");
	return decode(bytes.subarray(0, -1));
}

export function validPath(path: string): void {
	if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".."))
		throw new Error("Git returned an invalid path");
}

function records(bytes: Buffer): string[] {
	if (!bytes.length) return [];
	if (bytes.at(-1) !== 0) throw new Error("Git returned truncated NUL records");
	return decode(bytes.subarray(0, -1)).split("\0");
}

/** Raw records precede numstat records; -z gives renames separate path records in both sections. */
export function parseComparison(bytes: Buffer): ComparedChange[] {
	const fields = records(bytes);
	const raw: {
		change: ComparedChange;
		statOnlyCandidate: boolean;
		oldMode: string;
		newMode: string;
		source: string;
	}[] = [];
	let index = 0;
	while (fields[index]?.startsWith(":")) {
		const match =
			/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([AMDT]|[RC][0-9]{1,3})$/.exec(
				fields[index++] ?? "",
			);
		if (!match) throw new Error("Git returned an invalid raw diff record");
		const path = fields[index++];
		if (path === undefined) throw new Error("Git returned a truncated raw path");
		validPath(path);
		const status = match[5]?.[0];
		let destination = path;
		if (status === "R" || status === "C") {
			const next = fields[index++];
			if (next === undefined) throw new Error("Git returned a truncated rename");
			validPath(next);
			destination = next;
		}
		raw.push({
			change: {
				path: destination,
				kind:
					status === "A" || status === "C"
						? "added"
						: status === "D"
							? "deleted"
							: status === "R"
								? "renamed"
								: "modified",
				...(status === "R" ? { from: path } : {}),
			},
			statOnlyCandidate: status === "M" && match[1] === match[2] && /^0+$/.test(match[4] ?? ""),
			oldMode: match[1] as string,
			newMode: match[2] as string,
			source: path,
		});
	}
	const stats = new Set<string>();
	const rawPaths = new Set(raw.map(({ change }) => change.path));
	while (index < fields.length) {
		const stat = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[index++] ?? "");
		if (!stat || (stat[1] === "-") !== (stat[2] === "-")) throw new Error("Git returned an invalid numstat record");
		let path = stat[3] as string;
		if (!path) {
			const from = fields[index++];
			const to = fields[index++];
			if (from === undefined || to === undefined) throw new Error("Git returned truncated numstat rename paths");
			validPath(from);
			path = to;
		}
		validPath(path);
		if (!rawPaths.has(path)) throw new Error("Git returned numstat without a raw change");
		stats.add(path);
	}
	const changes: ComparedChange[] = [];
	for (const { change, statOnlyCandidate, oldMode, newMode, source } of raw) {
		// Raw diff alone includes stat noise and staged reversals when index refresh is disabled.
		// Only a same-mode worktree M without a numstat entry is noise. Zero counts, binary
		// markers and structural/mode changes remain changes even without textual lines.
		if (statOnlyCandidate && !stats.has(change.path)) continue;
		const oldLink = oldMode === "160000";
		const newLink = newMode === "160000";
		if (oldLink && newLink) continue;
		if (oldLink) {
			if (newMode !== "000000") changes.push({ path: change.path, kind: "added" });
		} else if (newLink) {
			if (oldMode !== "000000") changes.push({ path: source, kind: "deleted" });
		} else changes.push(change);
	}
	return changes;
}

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
	changes = changes.flatMap((item) =>
		item.from !== undefined && untracked.has(item.from)
			? [
					{ path: item.from, kind: "deleted" as const },
					{ path: item.path, kind: "added" as const },
				]
			: [item],
	);
	const ambiguous = changes.filter((item) => item.kind === "deleted" && untracked.has(item.path));
	if (ambiguous.length) {
		const config = records(await run(["config", "--null", "--list"]));
		const configValue = (key: string) =>
			config
				.filter((entry) => entry.slice(0, entry.indexOf("\n")).toLowerCase() === key)
				.at(-1)
				?.split("\n")
				.slice(1)
				.join("\n");
		const disabled = (value: string | undefined) => value !== undefined && /^(false|no|off|0)$/i.test(value);
		const fileMode = !disabled(configValue("core.filemode"));
		const symlinks = !disabled(configValue("core.symlinks"));
		const entries = new Map<string, { mode: string; oid: string }>();
		for (let start = 0; start < ambiguous.length; start += 100) {
			const batch = ambiguous.slice(start, start + 100);
			for (const record of records(
				await run(["ls-tree", "-z", baseline, "--", ...batch.map(({ path }) => `:(top,literal)${path}`)]),
			)) {
				const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
				if (!match) throw new Error("Invalid HEAD tree entry");
				entries.set(match[4] as string, { mode: match[1] as string, oid: match[3] as string });
			}
		}
		for (const item of ambiguous) {
			signal?.throwIfAborted();
			const entry = entries.get(item.path);
			if (!entry || !["100644", "100755", "120000"].includes(entry.mode))
				throw new Error("Missing ordinary HEAD reconciliation entry");
			const absolute = resolve(root, item.path);
			let stat: Awaited<ReturnType<typeof lstat>>;
			try {
				stat = await lstat(absolute);
			} catch (error) {
				if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
					untracked.delete(item.path);
					continue;
				}
				throw error;
			}
			if (!stat.isFile() && !stat.isSymbolicLink()) continue;
			let mode: string;
			let oid: string;
			if (stat.isSymbolicLink() || (!symlinks && entry.mode === "120000")) {
				mode = "120000";
				const bytes = stat.isSymbolicLink()
					? await readlink(absolute, { encoding: "buffer" })
					: await readFile(absolute);
				oid = line(await run(["hash-object", "--no-filters", "--stdin"], bytes));
			} else {
				mode = fileMode ? (stat.mode & 0o100 ? "100755" : "100644") : entry.mode === "100755" ? "100755" : "100644";
				oid = line(await run(["hash-object", `--path=${item.path}`, "--", item.path]));
			}
			untracked.delete(item.path);
			changes = changes.filter((change) => change !== item);
			if (mode !== entry.mode || oid !== entry.oid) changes.push({ path: item.path, kind: "modified" });
		}
	}
	changes.push(...[...untracked].map((path) => ({ path, kind: "added" as const })));
	return changes;
}
