import { randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import { ConfigurationError, type Loaded } from "./types.ts";
import { readText } from "./user-files.ts";

async function canonical(path: string, links = 0): Promise<string> {
	if (links > 40) throw new ConfigurationError("current_issue.directory: too many symbolic links");
	let current = "/";
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const target = join(current, part);
		try {
			if ((await lstat(target)).isSymbolicLink()) {
				const link = await readlink(target);
				current = await canonical(isAbsolute(link) ? link : `${current}/${link}`, links + 1);
			} else current = target;
		} catch (cause) {
			if (!(cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")))
				throw new ConfigurationError("current_issue.directory: cannot resolve directory", { cause });
			current = target;
		}
	}
	return current;
}

async function readState(path: string): Promise<Loaded<Record<string, unknown>>> {
	const text = await readText(path);
	if (text === undefined) return { value: {}, provenance: "default" };
	// Pinned Node supports source-aware JSON parsing before TypeScript's standard
	// library types do. Retain numeric tokens so unrelated Python integers and
	// precise decimals survive a selection write without IEEE-754 conversion.
	const json = JSON as typeof JSON & {
		parse(text: string, reviver: (key: string, value: unknown, context: { source?: string }) => unknown): unknown;
		rawJSON(text: string): object;
		isRawJSON(value: unknown): boolean;
	};
	let value: unknown;
	try {
		value = json.parse(text, (_key: string, entry: unknown, context: { source?: string }) =>
			typeof entry === "number" && context.source !== undefined ? json.rawJSON(context.source) : entry,
		);
	} catch (cause) {
		throw new ConfigurationError("$: invalid JSON state", { cause });
	}
	if (value === null || typeof value !== "object" || Array.isArray(value) || json.isRawJSON(value))
		throw new ConfigurationError("$: state must be a JSON object");
	const data = value as Record<string, unknown>;
	if (Object.hasOwn(data, "current_issue")) {
		const selection = data.current_issue;
		if (
			selection === null ||
			typeof selection !== "object" ||
			Array.isArray(selection) ||
			!("directory" in selection) ||
			typeof selection.directory !== "string" ||
			!selection.directory.trim() ||
			selection.directory.includes("\0")
		)
			throw new ConfigurationError("current_issue.directory: expected a nonblank directory string without NUL");
	}
	return { value: data, provenance: "file" };
}

function storedDirectory(state: Record<string, unknown>): string | undefined {
	return Object.hasOwn(state, "current_issue") ? (state.current_issue as { directory: string }).directory : undefined;
}

export async function loadCurrentIssue(path: string, workspaceRoot: string): Promise<Loaded<string | undefined>> {
	const loaded = await readState(path);
	const directory = storedDirectory(loaded.value);
	return {
		value:
			directory === undefined
				? undefined
				: await canonical(isAbsolute(directory) ? directory : `${workspaceRoot}/${directory}`),
		provenance: loaded.provenance,
	};
}

export async function writeCurrentIssue(path: string, workspaceRoot: string, directory: string): Promise<string> {
	if (typeof directory !== "string" || !directory.trim() || directory.includes("\0"))
		throw new ConfigurationError("current_issue.directory: expected a nonblank directory string without NUL");
	const selected = await canonical(isAbsolute(directory) ? directory : `${workspaceRoot}/${directory}`);
	const within = relative(workspaceRoot, selected);
	const stored =
		within === ""
			? "."
			: !within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within)
				? within.split(sep).join("/")
				: selected;
	const lock = `${path}.lock`;
	let locked = false;
	let temporary: string | undefined;
	try {
		await mkdir(dirname(path), { recursive: true });
		const deadline = performance.now() + 2000;
		while (!locked) {
			try {
				await mkdir(lock);
				locked = true;
			} catch (cause) {
				if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
				const remaining = deadline - performance.now();
				if (remaining <= 0)
					throw new ConfigurationError(
						`current_issue: lock timeout at ${lock}; confirm no writer remains before manually removing this lock`,
					);
				await setTimeout(Math.min(20, remaining));
			}
		}
		// A snapshot from before the shared writer lock could discard unrelated updates.
		const state = (await readState(path)).value;
		state.current_issue = { directory: stored };
		await writeFile(join(dirname(path), ".gitignore"), "*\n", "utf8");
		temporary = join(dirname(path), `.state-${randomUUID()}`);
		await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		await rename(temporary, path);
		return selected;
	} catch (cause) {
		if (cause instanceof ConfigurationError) throw cause;
		throw new ConfigurationError("current_issue: cannot initialize or atomically replace workspace state", { cause });
	} finally {
		try {
			if (temporary !== undefined)
				await unlink(temporary).catch((cause: unknown) => {
					if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) throw cause;
				});
		} finally {
			if (locked) await rmdir(lock);
		}
	}
}
