import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GitProcess, gitFailure } from "./process.ts";

/** A new normalized pair needs only an empty baseline object, owned outside the source store. */
export async function withEmptyBlob<T>(
	git: GitProcess,
	root: string,
	signal: AbortSignal | undefined,
	use: (git: GitProcess, oid: string) => Promise<T>,
): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "forge-empty-"));
	try {
		const location = await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], { signal });
		if (location.code) throw gitFailure("object location", location);
		const alternate = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
			.decode(location.stdout)
			.replace(/\n$/, "");
		const objects = join(directory, "objects");
		await mkdir(objects);
		const owned: GitProcess = (cwd, args, options = {}) =>
			git(cwd, args, { ...options, objectDirectory: objects, objectAlternates: JSON.stringify(alternate) });
		const empty = await owned(root, ["hash-object", "-w", "--stdin"], { signal, input: Buffer.alloc(0) });
		if (empty.code) throw gitFailure("empty blob", empty);
		return await use(owned, empty.stdout.toString().trim());
	} finally {
		// GitProcess settles after filter descendants, before owned resources are removed.
		await rm(directory, { recursive: true, force: true });
	}
}
