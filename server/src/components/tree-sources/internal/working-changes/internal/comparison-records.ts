import type { ComparedChange } from "./types.ts";

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

export function records(bytes: Buffer): string[] {
	if (!bytes.length) return [];
	if (bytes.at(-1) !== 0) throw new Error("Git returned truncated NUL records");
	return decode(bytes.subarray(0, -1)).split("\0");
}

function renameContentChanged(oldId: string | undefined, newId: string | undefined): boolean {
	if (!oldId || !newId || oldId.length !== newId.length || /^0+$/.test(oldId) || /^0+$/.test(newId))
		throw new Error("Git returned invalid rename object identities");
	return oldId !== newId;
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
				...(status === "R" ? { from: path, renameContentChanged: renameContentChanged(match[3], match[4]) } : {}),
				oldMode: match[1] as string,
				newMode: match[2] as string,
				statistics: { added: 0, removed: 0, binary: false },
				...(status === "C" ? { correction: "addition" as const } : {}),
			},
			statOnlyCandidate: status === "M" && match[1] === match[2] && /^0+$/.test(match[4] ?? ""),
			oldMode: match[1] as string,
			newMode: match[2] as string,
			source: path,
		});
	}
	const stats = new Map<string, ComparedChange["statistics"]>();
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
		stats.set(path, {
			added: stat[1] === "-" ? 0 : Number(stat[1]),
			removed: stat[2] === "-" ? 0 : Number(stat[2]),
			binary: stat[1] === "-",
		});
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
		const { from: _from, renameContentChanged: _renameContentChanged, ...nonRename } = change;
		if (oldLink) {
			if (newMode !== "000000")
				changes.push({ ...nonRename, oldMode: "000000", kind: "added", correction: "addition" });
		} else if (newLink) {
			if (oldMode !== "000000")
				changes.push({ ...nonRename, path: source, newMode: "000000", kind: "deleted", correction: "deletion" });
		} else changes.push({ ...change, statistics: stats.get(change.path) ?? change.statistics });
	}
	return changes;
}
