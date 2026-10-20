import { constants, type Stats } from "node:fs";
import { lstat, open, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Git, nulRecords, objectId } from "./git.ts";
import type { TreeEntry } from "./types.ts";

export function inside(root: string, path: string): boolean {
	const offset = relative(root, path);
	return !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

export function validTreePath(path: string): void {
	if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
		throw new Error("Git returned an invalid tree path");
	}
}

export function parseTree(bytes: Buffer): TreeEntry[] {
	return nulRecords(bytes).map((record) => {
		const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(record);
		if (!match || (match[1] === "160000") !== (match[2] === "commit")) {
			throw new Error("Git returned an invalid tree entry");
		}
		const path = match[4] as string;
		validTreePath(path);
		return { mode: match[1] as string, oid: match[3] as string, path };
	});
}

function absent(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** Boundary checks inspect directories only; symlink ancestors are never followed. */
export async function scopedPath(
	repositoryRoot: string,
	workspaceRoot: string,
	participantRoot: string,
	exclusions: readonly string[],
	path: string,
): Promise<boolean> {
	validTreePath(path);
	if (path.split("/").some((part) => part.toLowerCase() === ".git")) return false;
	const absolute = resolve(repositoryRoot, path);
	if (!inside(workspaceRoot, absolute) || !inside(participantRoot, absolute)) return false;
	if (exclusions.some((root) => inside(root, absolute))) return false;
	const parts = relative(participantRoot, absolute).split(sep);
	let current = participantRoot;
	for (const part of parts) {
		current = resolve(current, part);
		let status: Stats;
		try {
			status = await lstat(current);
		} catch (error) {
			if (absent(error)) return true;
			throw error;
		}
		if (!status.isDirectory() || status.isSymbolicLink()) return true;
		try {
			await lstat(resolve(current, ".git"));
			return false;
		} catch (error) {
			if (!absent(error)) throw error;
		}
	}
	return true;
}

export async function captureEntry(
	root: string,
	path: string,
	headMode: string | undefined,
	fileMode: boolean,
	git: Git,
): Promise<TreeEntry | undefined> {
	let current = root;
	const parts = path.split("/");
	for (const part of parts.slice(0, -1)) {
		current = resolve(current, part);
		try {
			const status = await lstat(current);
			if (!status.isDirectory() || status.isSymbolicLink()) return undefined;
		} catch (error) {
			if (absent(error)) return undefined;
			throw error;
		}
	}
	const absolute = resolve(root, path);
	let status: Stats;
	try {
		status = await lstat(absolute);
	} catch (error) {
		if (absent(error)) return undefined;
		throw error;
	}
	if (status.isDirectory()) return undefined;
	let data: Buffer;
	let mode: string;
	if (status.isSymbolicLink()) {
		data = await readlink(absolute, { encoding: "buffer" });
		mode = "120000";
	} else if (status.isFile()) {
		const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			data = await handle.readFile();
		} finally {
			await handle.close();
		}
		mode = fileMode ? (status.mode & 0o111 ? "100755" : "100644") : headMode === "100755" ? "100755" : "100644";
	} else {
		throw new Error(`Unsupported working-copy file type: ${path}`);
	}
	return { path, mode, oid: objectId(await git.run(["hash-object", "-w", "--stdin"], data)) };
}

export async function writeTree(git: Git, entries: readonly TreeEntry[]): Promise<string> {
	await git.run(["read-tree", "--empty"]);
	if (entries.length) {
		const input = Buffer.from(entries.map((entry) => `${entry.mode} ${entry.oid}\t${entry.path}\0`).join(""));
		await git.run(["update-index", "-z", "--index-info"], input);
	}
	return objectId(await git.run(["write-tree"]));
}
