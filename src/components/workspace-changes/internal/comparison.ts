import type { WorkspaceChange } from "../../workspace-policy/index.ts";
import { decode, type Git, nulRecords } from "./git.ts";
import { validTreePath, writeTree } from "./snapshot.ts";
import type { RawChange, TreeEntry } from "./types.ts";

export function parseRaw(bytes: Buffer): RawChange[] {
	const records = nulRecords(bytes);
	const result: RawChange[] = [];
	for (let position = 0; position < records.length; ) {
		const header = records[position++];
		const match =
			/^:(000000|100644|100755|120000) (000000|100644|100755|120000) ([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64}) ([ADMRT]|[RC](?:100|0?[0-9]{1,2}))$/.exec(
				header ?? "",
			);
		if (!match) throw new Error("Git returned an invalid raw diff header");
		const oldPath = records[position++];
		const status = (match[5] as string)[0] as string;
		const newPath = status === "R" || status === "C" ? records[position++] : oldPath;
		if (!oldPath || !newPath) throw new Error("Git returned an incomplete raw diff");
		validTreePath(oldPath);
		validTreePath(newPath);
		result.push({
			oldMode: match[1] as string,
			newMode: match[2] as string,
			oldOid: match[3] as string,
			newOid: match[4] as string,
			status,
			oldPath,
			newPath,
		});
	}
	return result;
}

interface Statistics {
	readonly added: number | null;
	readonly removed: number | null;
}

export function parseNumstat(bytes: Buffer): ReadonlyMap<string, Statistics> {
	const result = new Map<string, Statistics>();
	if (!bytes.length) return result;
	if (bytes.at(-1) !== 0) throw new Error("Git returned truncated numstat output");
	const records = decode(bytes.subarray(0, -1)).split("\0");
	for (let position = 0; position < records.length; ) {
		const record = records[position++];
		const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(record ?? "");
		if (!match || (match[1] === "-") !== (match[2] === "-")) {
			throw new Error("Git returned invalid numstat output");
		}
		const oldPath = match[3] || records[position++];
		const newPath = match[3] || records[position++];
		if (!oldPath || !newPath) throw new Error("Git returned incomplete rename numstat output");
		validTreePath(oldPath);
		validTreePath(newPath);
		const key = `${oldPath}\0${newPath}`;
		if (result.has(key)) throw new Error("Git returned duplicate numstat records");
		const added = match[1] === "-" ? null : Number(match[1]);
		const removed = match[2] === "-" ? null : Number(match[2]);
		if ((added !== null && !Number.isSafeInteger(added)) || (removed !== null && !Number.isSafeInteger(removed))) {
			throw new Error("Git returned invalid line counts");
		}
		result.set(key, { added, removed });
	}
	return result;
}

const diffOptions = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "-M", "-C"];

export async function compareTrees(git: Git, base: string, final: string, empty: string) {
	const changes = parseRaw(await git.run(["diff", "--raw", "-z", "--no-abbrev", ...diffOptions, base, final]));
	const statistics = parseNumstat(await git.run(["diff", "--numstat", "-z", ...diffOptions, base, final]));
	const result: { change: WorkspaceChange; binary: boolean; addedLines: number | null; removedLines: number | null }[] =
		[];
	for (const raw of changes) {
		const counts = statistics.get(`${raw.oldPath}\0${raw.newPath}`);
		if (!counts) throw new Error("Git omitted comparison line statistics");
		let binary = counts.added === null;
		// Git emits zero counts for an unchanged blob even when its content is binary.
		// Compare that same path against absence to retain content classification.
		if (!binary && raw.oldOid === raw.newOid) {
			const entry: TreeEntry = { mode: raw.newMode, oid: raw.newOid, path: raw.newPath };
			const singleton = await writeTree(git, [entry]);
			await git.run(["read-tree", final]);
			const probe = parseNumstat(await git.run(["diff", "--numstat", "-z", ...diffOptions, empty, singleton]));
			binary = probe.get(`${entry.path}\0${entry.path}`)?.added === null;
		}
		const kind: WorkspaceChange["kind"] =
			raw.status === "A"
				? "added"
				: raw.status === "D"
					? "deleted"
					: raw.status === "R"
						? "renamed"
						: raw.status === "C"
							? "copied"
							: raw.status === "T" || raw.oldMode.slice(0, 2) !== raw.newMode.slice(0, 2)
								? "type_changed"
								: "modified";
		result.push({
			change: {
				repo: "",
				path: raw.newPath,
				kind,
				...(kind === "renamed" || kind === "copied" ? { from: raw.oldPath } : {}),
			},
			binary,
			addedLines: binary ? null : counts.added,
			removedLines: binary ? null : counts.removed,
		});
	}
	return result;
}
