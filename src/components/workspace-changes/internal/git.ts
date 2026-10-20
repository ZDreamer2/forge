import { spawn } from "node:child_process";

const outputLimit = 64 * 1024 * 1024;

export interface Git {
	run(args: readonly string[], input?: Buffer): Promise<Buffer>;
	tryRun(args: readonly string[]): Promise<{ code: number; stdout: Buffer }>;
}

export function gitEnvironment(env: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
	const clean: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(env)) {
		if (!name.startsWith("GIT_")) clean[name] = value;
	}
	return { ...clean, GIT_OPTIONAL_LOCKS: "0", GIT_ATTR_NOSYSTEM: "1", LC_ALL: "C" };
}

export function createGit(root: string, env: Readonly<NodeJS.ProcessEnv>): Git {
	const execute = (args: readonly string[], input?: Buffer) =>
		new Promise<{ code: number; stdout: Buffer }>((resolve, reject) => {
			const child = spawn(
				"git",
				[
					"--literal-pathspecs",
					"-c",
					"core.fsmonitor=false",
					"-c",
					"core.untrackedCache=false",
					// Index plumbing still uses the source Git directory for config and refs.
					// Disable features that write there or execute source checkout automation.
					"-c",
					"core.splitIndex=false",
					"-c",
					"core.hooksPath=/dev/null",
					"-c",
					"core.attributesFile=/dev/null",
					...args,
				],
				{ cwd: root, env: { ...env }, stdio: ["pipe", "pipe", "pipe"] },
			);
			const chunks: Buffer[] = [];
			let size = 0;
			let failure: Error | undefined;
			const consume = (chunk: Buffer, keep: boolean) => {
				size += chunk.length;
				if (size > outputLimit) {
					failure = new Error("Git output exceeded the collection limit");
					child.kill();
				} else if (keep) chunks.push(chunk);
			};
			child.stdout.on("data", (chunk: Buffer) => consume(chunk, true));
			child.stderr.on("data", (chunk: Buffer) => consume(chunk, false));
			child.on("error", reject);
			child.stdin.on("error", (error) => {
				failure ??= error;
			});
			child.on("close", (code) => {
				if (failure) reject(failure);
				else if (code === null) reject(new Error("Git collection process terminated"));
				else resolve({ code, stdout: Buffer.concat(chunks) });
			});
			child.stdin.end(input);
		});
	return {
		tryRun: (args) => execute(args),
		async run(args, input) {
			const result = await execute(args, input);
			if (result.code !== 0) throw new Error(`Git collection failed (${args[0]})`);
			return result.stdout;
		},
	};
}

export function decode(bytes: Buffer): string {
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function nulRecords(bytes: Buffer): string[] {
	if (bytes.length === 0) return [];
	if (bytes.at(-1) !== 0) throw new Error("Git returned truncated NUL records");
	const records = decode(bytes.subarray(0, -1)).split("\0");
	if (records.some((record) => record.length === 0)) {
		throw new Error("Git returned empty NUL records");
	}
	return records;
}

export function line(bytes: Buffer): string {
	if (bytes.at(-1) !== 10) throw new Error("Git returned a truncated line");
	return decode(bytes.subarray(0, -1));
}

export function objectId(bytes: Buffer): string {
	const value = line(bytes);
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
		throw new Error("Git returned an invalid object ID");
	}
	return value;
}
