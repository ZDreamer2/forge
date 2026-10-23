import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface Config {
	readonly root: string;
	readonly policyPath: string;
	readonly port: number;
}

interface ConfigInput {
	workspace: string;
	cwd: string;
	env: Readonly<Record<string, string | undefined>>;
}

export async function loadConfig({ workspace, cwd, env }: ConfigInput): Promise<Readonly<Config>> {
	const guidance = env.ZD_AI_FORGE_WORKSPACE_GUIDE || "docs/forge/workspace";
	const processPort = env.ZD_AI_FORGE_PORT;
	const selected = resolve(cwd, workspace);
	if (!(await stat(selected)).isDirectory()) {
		throw new Error("Workspace must be a directory");
	}
	const root = await realpath(selected);
	const policyPath = join(resolve(root, guidance), "workspace.ts");
	if (!(await stat(policyPath)).isFile()) {
		throw new Error("Workspace policy must be a workspace.ts file in the selected guidance folder");
	}
	const dotenvPort = await readDotenvPort(join(root, ".env"));
	const value = processPort || dotenvPort || "";
	if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
		throw new Error("ZD_AI_FORGE_PORT must be an ASCII decimal TCP port from 1024 through 65535");
	}
	return Object.freeze({ root, policyPath, port: Number(value) });
}

async function readDotenvPort(path: string): Promise<string | undefined> {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw new Error("Cannot read the workspace .env file as UTF-8");
	}
	let port: string | undefined;
	// Match the workspace's narrow dotenv syntax: no interpolation, escapes,
	// inline comments or multiline values; the last assignment wins.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Python splitlines recognizes these separators.
	for (const raw of text.split(/\r\n|[\n\r\v\f\x1c-\x1e\u0085\u2028\u2029]/)) {
		let line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		if (line.startsWith("export ")) line = line.slice(7).trimStart();
		const separator = line.indexOf("=");
		if (separator < 0 || line.slice(0, separator).trim() !== "ZD_AI_FORGE_PORT") continue;
		let value = line.slice(separator + 1).trim();
		if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
			value = value.slice(1, -1);
		}
		port = value;
	}
	return port;
}
