import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { withEmptyBlob } from "./empty-blob.ts";
import { type IndexContext, indexAttributes } from "./index-attributes.ts";
import { GitOutputLimitError, type GitProcess, gitFailure } from "./process.ts";
import { withScratchIndex } from "./scratch-index.ts";

export const FILE_RAW_LIMIT = 8 * 1024 * 1024;
export const FILE_PATCH_LIMIT = 4 * 1024 * 1024;

export type FileComparison = IndexContext | { readonly kind: "whole-addition" };

export interface FilePatchInput {
	readonly baselineOid: string;
	readonly oldPath: string;
	readonly newPath: string;
	readonly oldMode: string;
	readonly newMode: string;
	readonly comparison: FileComparison;
	readonly context?: 3 | "all";
	readonly headerOldPath?: string;
	readonly headerNewPath?: string;
}

function quote(path: string): string {
	const bytes = Buffer.from(path);
	if (!bytes.some((value) => value < 32 || value >= 127 || value === 34 || value === 92)) return path;
	return `"${Array.from(bytes, (value) => (value === 34 ? '\\"' : value === 92 ? "\\\\" : value === 9 ? "\\t" : value === 10 ? "\\n" : value === 13 ? "\\r" : value < 32 || value >= 127 ? `\\${value.toString(8).padStart(3, "0")}` : String.fromCharCode(value))).join("")}"`;
}

/** Remap the one Git frame's metadata; its hunk bytes and alignment remain untouched. */
function header(input: FilePatchInput, patch: Buffer): Buffer {
	const boundary = patch.indexOf("\n@@ ");
	const hunk = boundary < 0 ? -1 : boundary + 1;
	const metadata = patch.subarray(0, hunk < 0 ? patch.length : hunk).toString();
	if (patch.length && (metadata.match(/^diff --git /gm) ?? []).length !== 1)
		throw new Error("Unexpected per-file patch frame");
	const oldPath = input.headerOldPath ?? input.oldPath,
		newPath = input.headerNewPath ?? input.newPath,
		old = quote(`a/${oldPath}`),
		current = quote(`b/${newPath}`);
	let text = `diff --git ${old} ${current}\n`;
	if (input.oldMode === "000000") text += `new file mode ${input.newMode}\n`;
	else if (input.newMode === "000000") text += `deleted file mode ${input.oldMode}\n`;
	else if (input.oldMode !== input.newMode) text += `old mode ${input.oldMode}\nnew mode ${input.newMode}\n`;
	if (oldPath !== newPath) text += `rename from ${quote(oldPath)}\nrename to ${quote(newPath)}\n`;
	if (hunk >= 0)
		text += `--- ${input.oldMode === "000000" ? "/dev/null" : old}\n+++ ${input.newMode === "000000" ? "/dev/null" : current}\n`;
	const result = hunk < 0 ? Buffer.from(text) : Buffer.concat([Buffer.from(text), patch.subarray(hunk)]);
	if (result.length > FILE_PATCH_LIMIT) throw new GitOutputLimitError("Patch exceeds limit");
	return result;
}

/** Acquire the reconciled pair directly, without materializing or re-filtering either side. */
export async function createFilePatch(
	git: GitProcess,
	root: string,
	input: FilePatchInput,
	signal?: AbortSignal,
): Promise<Buffer> {
	signal?.throwIfAborted();
	const current = input.newMode === "000000" ? undefined : await lstat(resolve(root, input.newPath));
	if (current && !(current.isFile() || current.isSymbolicLink())) throw new Error("Current side changed kind");
	if (current && current.size > FILE_RAW_LIMIT) throw new GitOutputLimitError("Raw file exceeds limit");
	const flags = [
		"--patch",
		"--text",
		`--unified=${input.context === "all" ? 2147483647 : 3}`,
		"--inter-hunk-context=0",
		"--no-color",
		"--src-prefix=a/",
		"--dst-prefix=b/",
		"--no-ext-diff",
		"--no-textconv",
		"--no-relative",
		"--no-renames",
	];
	const run = async (worker: GitProcess, args: readonly string[], allowDifference = false) => {
		const result = await worker(
			root,
			["-c", "diff.mnemonicPrefix=false", "-c", "diff.noprefix=false", "-c", "diff.suppressBlankEmpty=false", ...args],
			// Published headers may be shorter than Git's absolute no-index paths.
			{ signal, maxStdoutBytes: FILE_PATCH_LIMIT + 65536 },
		);
		if (result.code !== 0 && !(allowDifference && result.code === 1)) throw gitFailure("file patch", result);
		return result.stdout;
	};
	let patch: Buffer;
	if (input.comparison.kind === "whole-addition") {
		// Keep the collector's repository cwd: no-index still applies its clean/eol attributes.
		patch = await run(git, ["diff", "--no-index", ...flags, "--", "/dev/null", resolve(root, input.newPath)], true);
	} else {
		const selectedPath = input.newMode === "000000" ? input.oldPath : input.newPath;
		const attributes = await indexAttributes(git, root, selectedPath, input.comparison, signal);
		// The selected baseline/empty entry owns this slot. A deletion must leave it absent.
		const ancestors = attributes.filter(({ path }) => path !== selectedPath);
		const compare = (worker: GitProcess, oid: string) =>
			withScratchIndex(
				worker,
				root,
				// Current effective mode prevents Git from splitting file/link transitions into two pairs.
				[...ancestors, { path: input.newPath, mode: input.newMode, oid }],
				signal,
				(scratch) => run(scratch, ["diff-files", ...flags, "--", `:(top,literal)${input.newPath}`]),
			);
		if (input.newMode === "000000")
			patch = await withScratchIndex(git, root, ancestors, signal, (scratch) =>
				run(scratch, ["diff", "--cached", ...flags, input.baselineOid, "--", `:(top,literal)${input.oldPath}`]),
			);
		else if (input.oldMode === "000000") patch = await withEmptyBlob(git, root, signal, compare);
		else {
			const entry = await git(root, ["ls-tree", "-z", input.baselineOid, "--", `:(top,literal)${input.oldPath}`], {
				signal,
			});
			if (entry.code) throw gitFailure("baseline entry", entry);
			const match = /^([0-7]{6}) blob ([0-9a-f]{40,64})\t([\s\S]*)\0$/.exec(entry.stdout.toString());
			if (!match || match[1] !== input.oldMode || match[3] !== input.oldPath)
				throw new Error("Required baseline entry changed");
			patch = await compare(git, match[2] as string);
		}
	}
	if (current) {
		const after = await lstat(resolve(root, input.newPath));
		if (current.isFile() !== after.isFile() || current.isSymbolicLink() !== after.isSymbolicLink())
			throw new Error("Current side changed kind");
		if (after.size > FILE_RAW_LIMIT) throw new GitOutputLimitError("Raw file exceeds limit");
	}
	return header(input, patch);
}
