import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GitProcess, gitFailure } from "./process.ts";

export interface IndexEntry {
	readonly path: string;
	readonly mode: string;
	readonly oid: string;
}

/** The owned index never shares writes or split-index resources with the source checkout. */
export async function withScratchIndex<T>(
	git: GitProcess,
	root: string,
	entries: readonly IndexEntry[],
	signal: AbortSignal | undefined,
	use: (git: GitProcess) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "forge-index-"));
	const scratchIndex = join(directory, "index");
	const scratch: GitProcess = (cwd, args, options = {}) =>
		git(cwd, ["-c", "core.splitIndex=false", ...args], { ...options, scratchIndex });
	try {
		const empty = await scratch(root, ["read-tree", "--empty"], { signal });
		if (empty.code !== 0) throw gitFailure("scratch index initialization", empty);
		if (entries.length) {
			for (const entry of entries) {
				if (
					!/^(100644|100755|120000)$/.test(entry.mode) ||
					!/^[0-9a-f]{40,64}$/.test(entry.oid) ||
					entry.path.includes("\0")
				)
					throw new Error("Invalid scratch index entry");
			}
			const input = Buffer.from(entries.map(({ mode, oid, path }) => `${mode} ${oid}\t${path}\0`).join(""));
			const seeded = await scratch(root, ["update-index", "-z", "--index-info"], { signal, input });
			if (seeded.code !== 0) throw gitFailure("scratch index seeding", seeded);
		}
		return await use(scratch);
	} finally {
		// GitProcess settles after filter descendants; removing here cannot race their index access.
		await rm(directory, { recursive: true, force: true });
	}
}
