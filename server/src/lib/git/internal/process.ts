import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export class GitOutputLimitError extends Error {}

export type GitResult = { code: number; stdout: Buffer; stderr: Buffer };
export type GitProcess = (
	cwd: string,
	args: readonly string[],
	options?: {
		signal?: AbortSignal;
		timeoutMs?: number;
		maxOutputBytes?: number;
		maxStdoutBytes?: number;
		objectDirectory?: string;
		objectAlternates?: string;
		input?: Buffer;
		scratchIndex?: string;
	},
) => Promise<GitResult>;

/** Keep deliberate config isolation while ignoring ambient checkout/index redirection. */
export function createGitProcess(environment: Readonly<NodeJS.ProcessEnv>): GitProcess {
	const env: NodeJS.ProcessEnv = {};
	const configIsolation = new Set([
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_SYSTEM",
		"GIT_CONFIG_NOSYSTEM",
		"GIT_ATTR_NOSYSTEM",
	]);
	for (const [name, value] of Object.entries(environment)) {
		if (!name.startsWith("GIT_") || configIsolation.has(name)) env[name] = value;
	}
	Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });
	return (cwd, args, options = {}) =>
		new Promise<GitResult>((resolve, reject) => {
			if (options.signal?.aborted) {
				reject(options.signal.reason ?? new Error("Git operation aborted"));
				return;
			}
			if ((options.input?.length ?? 0) > 16 * 1024 * 1024) {
				reject(new Error("Git input exceeded the collection limit"));
				return;
			}
			const child = spawn(
				"git",
				[
					"--no-optional-locks",
					"-c",
					"core.fsmonitor=false",
					"-c",
					"core.hooksPath=/dev/null",
					"-c",
					"gc.auto=0",
					"-c",
					"maintenance.auto=false",
					"-c",
					"diff.autoRefreshIndex=false",
					...args,
				],
				{
					cwd,
					env: {
						...env,
						...(options.scratchIndex ? { GIT_INDEX_FILE: options.scratchIndex } : {}),
						...(options.objectDirectory ? { GIT_OBJECT_DIRECTORY: options.objectDirectory } : {}),
						...(options.objectAlternates ? { GIT_ALTERNATE_OBJECT_DIRECTORIES: options.objectAlternates } : {}),
					},
					detached: true,
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let size = 0;
			let stdoutSize = 0;
			let failure: Error | undefined;
			let killTimer: NodeJS.Timeout | undefined;
			let closed = false;
			let exitCode: number | null = null;
			const signalGroup = (signal: NodeJS.Signals): boolean => {
				if (!child.pid) return false;
				try {
					process.kill(-child.pid, signal);
					return true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure ??= error as Error;
					return false;
				}
			};
			const settle = () => {
				if (!closed || killTimer) return;
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", abort);
				if (failure) reject(failure);
				else if (exitCode === null) reject(new Error("Git process terminated"));
				else resolve({ code: exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
			};
			const terminate = () => {
				if (killTimer || !signalGroup("SIGTERM")) return;
				// A filter may outlive Git or ignore TERM. Keep the group escalation even after Git closes.
				killTimer = setTimeout(() => {
					signalGroup("SIGKILL");
					killTimer = undefined;
					settle();
				}, 250);
			};
			const stop = (error: Error) => {
				if (failure) return;
				failure = error;
				terminate();
			};
			const abort = () => stop(new Error("Git operation aborted", { cause: options.signal?.reason }));
			const timer = setTimeout(
				() => stop(new Error(`Git command timed out (${args[0] ?? "unknown"})`)),
				options.timeoutMs ?? 30_000,
			);
			options.signal?.addEventListener("abort", abort, { once: true });
			if (options.signal?.aborted) abort();
			const consume = (chunks: Buffer[], chunk: Buffer) => {
				size += chunk.length;
				if (size > Math.min(options.maxOutputBytes ?? 16 * 1024 * 1024, 16 * 1024 * 1024))
					stop(new Error("Git output exceeded the collection limit"));
				else if (!failure) chunks.push(chunk);
			};
			child.stdout.on("data", (chunk: Buffer) => {
				stdoutSize += chunk.length;
				if (options.maxStdoutBytes !== undefined && stdoutSize > options.maxStdoutBytes)
					stop(new GitOutputLimitError("Git stdout limit exceeded"));
				else consume(stdout, chunk);
			});
			child.stderr.on("data", (chunk: Buffer) => consume(stderr, chunk));
			child.stdin.on("error", (error: NodeJS.ErrnoException) => {
				// A command can reject its arguments and close stdin before consuming the supplied bytes.
				if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") stop(error);
			});
			child.stdin.end(options.input);
			child.on("error", (error) => {
				failure ??= error;
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				closed = true;
				exitCode = code;
				terminate();
				settle();
			});
		});
}

export function gitFailure(operation: string, result: GitResult): Error {
	const detail = result.stderr
		.subarray(0, 1000)
		.toString("utf8")
		.replace(/\p{Cc}/gu, " ")
		.trim();
	return new Error(`Git ${operation} failed (${result.code})${detail ? `: ${detail}` : ""}`);
}

/** Refuse incomplete object stores before commands can request missing objects. Trusted filters remain enabled. */
export async function preflightRepository(
	git: GitProcess,
	cwd: string,
	signal?: AbortSignal,
	objectPath?: string,
): Promise<void> {
	const result = await git(cwd, ["config", "--null", "--list"], { signal });
	if (result.code !== 0) throw gitFailure("configuration inspection", result);
	const text = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
	if (text && !text.endsWith("\0")) throw new Error("Git returned truncated configuration");
	for (const record of text.split("\0").slice(0, -1)) {
		const separator = record.indexOf("\n");
		const key = (separator < 0 ? record : record.slice(0, separator)).toLowerCase();
		const value = separator < 0 ? "" : record.slice(separator + 1);
		if (
			key === "extensions.partialclone" ||
			(/^remote\..+\.promisor$/s.test(key) && !/^(false|no|off|0)$/i.test(value.trim()))
		) {
			throw new Error("Partial/promisor repositories are unsupported for read-only collection");
		}
	}
	let path = objectPath;
	if (path === undefined) {
		const location = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], { signal });
		if (location.code !== 0) throw gitFailure("object-store location", location);
		path = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(location.stdout).replace(/\n$/, "");
	}
	if (!path || path.includes("\0")) throw new Error("Git returned an invalid object-store location");
	const objects = isAbsolute(path) ? path : resolve(cwd, path);
	try {
		const names = await readdir(join(objects, "pack"));
		if (names.some((name) => name.endsWith(".promisor"))) {
			throw new Error("Partial/promisor repositories are unsupported for read-only collection");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
