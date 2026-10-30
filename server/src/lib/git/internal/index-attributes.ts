import { type GitProcess, gitFailure } from "./process.ts";
import type { IndexEntry } from "./scratch-index.ts";

export type IndexContext =
	| { readonly kind: "source-index" }
	| { readonly kind: "scratch-index"; readonly entries: readonly IndexEntry[] };

/** Preserve this literal path's attribute fallbacks from the actual comparison index. */
export async function indexAttributes(
	git: GitProcess,
	root: string,
	path: string,
	context: IndexContext,
	signal?: AbortSignal,
): Promise<IndexEntry[]> {
	const parts = path.split("/");
	const paths = parts.map((_, index) => [...parts.slice(0, index), ".gitattributes"].join("/"));
	const wanted = new Set(paths);
	if (context.kind === "scratch-index") return context.entries.filter((entry) => wanted.has(entry.path));
	const entries = new Map<string, IndexEntry>();
	for (let start = 0; start < paths.length; start += 100) {
		const result = await git(
			root,
			["ls-files", "--stage", "-z", "--", ...paths.slice(start, start + 100).map((path) => `:(top,literal)${path}`)],
			{ signal },
		);
		if (result.code) throw gitFailure("indexed attributes", result);
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.stdout);
		if (text && !text.endsWith("\0")) throw new Error("Truncated indexed attributes");
		for (const record of text.split("\0").slice(0, -1)) {
			const match = /^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]*)$/.exec(record);
			if (!match) throw new Error("Invalid indexed attribute entry");
			const [, mode, oid, stage, entryPath] = match;
			// A literal pathspec may also select a directory named .gitattributes.
			if (!entryPath || !wanted.has(entryPath) || !/^(100644|100755|120000)$/.test(mode as string)) continue;
			// Git's own attribute fallback reads stage 2 when the source attribute file is unmerged.
			if (stage === "0" || (stage === "2" && !entries.has(entryPath)))
				entries.set(entryPath, { path: entryPath, mode: mode as string, oid: oid as string });
		}
	}
	return [...entries.values()];
}
