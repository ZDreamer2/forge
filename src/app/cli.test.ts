import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(new URL("../main.ts", import.meta.url));
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "forge-cli-"));
	execFileSync("git", ["init", "-q", root]);
	await mkdir(join(root, "docs/forge/workspace"), { recursive: true });
	const policy = join(root, "docs/forge/workspace/workspace.ts");
	await writeFile(
		policy,
		"export default { repositories: [{path:'.'}, {path:'absent'}], codebasesForChange: () => [] };",
	);
	return { root, policy };
}
async function reservePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return {
		port: address.port,
		close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}
function run(args: string[], env: Record<string, string | undefined> = {}) {
	const child = spawn(process.execPath, [main, ...args], {
		cwd: tmpdir(),
		env: { ...process.env, ZD_AI_FORGE_PORT: "", ZD_AI_FORGE_WORKSPACE_GUIDE: "", ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (data) => {
		stdout += data;
	});
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
		child.once("exit", (code, signal) => resolve({ code, signal })),
	);
	return { child, exited, stdout: () => stdout, stderr: () => stderr };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("CLI timed out")), 5000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function ready(process: ReturnType<typeof run>) {
	await bounded(
		new Promise<void>((resolve, reject) => {
			const check = (data: Buffer) => {
				if (data.toString().includes("http://127.0.0.1:")) resolve();
			};
			process.child.stdout.on("data", check);
			process.exited.then(() => reject(new Error(process.stderr())));
		}),
	);
}

test("CLI validates serve arguments and preserves diagnostic JSON", async () => {
	const { root, policy } = await fixture();
	try {
		for (const args of [
			["serve"],
			["serve", "--workspace"],
			["serve", root],
			["serve", "--workspace", root, "extra"],
		]) {
			const process = run(args);
			try {
				assert.equal((await bounded(process.exited)).code, 1);
				assert.match(process.stderr(), /Usage:/);
			} finally {
				process.child.kill("SIGKILL");
			}
		}
		const process = run(["inspect-workspace", policy, ".", "a.ts"]);
		try {
			assert.equal((await bounded(process.exited)).code, 0, process.stderr());
			assert.deepEqual(JSON.parse(process.stdout()), { included: true, codebases: [] });
		} finally {
			process.child.kill("SIGKILL");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI uses selected .env, serves fresh read-only changes and releases port on signals", async () => {
	const { root } = await fixture();
	try {
		await writeFile(join(root, ".gitignore"), ".env\n");
		await writeFile(join(root, "tracked"), "original\n");
		execFileSync("git", ["-C", root, "add", "."]);
		execFileSync("git", [
			"-C",
			root,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.com",
			"commit",
			"-qm",
			"baseline",
		]);
		await writeFile(join(root, "tracked"), "staged\n");
		execFileSync("git", ["-C", root, "add", "tracked"]);
		await writeFile(join(root, "tracked"), "first\n");
		const index = await readFile(join(root, ".git/index"));
		const status = execFileSync("git", ["-C", root, "status", "--porcelain=v1"]);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			await writeFile(join(root, "tracked"), "first\n");
			const reservation = await reservePort();
			await reservation.close();
			await writeFile(join(root, ".env"), `ZD_AI_FORGE_PORT=${reservation.port}\n`);
			const process = run(["serve", "--workspace", root]);
			try {
				await ready(process);
				assert.equal(process.stdout().trim(), `http://127.0.0.1:${reservation.port}`);
				const response = await fetch(`${process.stdout().trim()}/api/workspace`);
				assert.equal(response.status, 200);
				assert.deepEqual(await response.json(), {
					workspace: { root },
					repositories: [
						{ path: ".", status: "available", gitRoot: root },
						{ path: "absent", status: "missing" },
					],
				});
				const address = process.stdout().trim();
				const change = (addedLines: number) => ({
					repo: ".",
					path: "tracked",
					kind: "modified",
					binary: false,
					addedLines,
					removedLines: 1,
					codebases: [],
				});
				assert.deepEqual(await (await fetch(`${address}/api/changes`)).json(), { changes: [change(1)] });
				await writeFile(join(root, "tracked"), "second\nextra\n");
				assert.deepEqual(await (await fetch(`${address}/api/changes`)).json(), { changes: [change(2)] });
				assert.equal((await fetch(`${address}/api/changes`, { headers: { origin: "http://foreign" } })).status, 403);
				const unsupported = await fetch(`${address}/api/changes`, { method: "OPTIONS" });
				assert.equal(unsupported.status, 405);
				assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
				process.child.kill(signal);
				assert.deepEqual(await bounded(process.exited), { code: 0, signal: null });
				const probe = createServer();
				probe.listen(reservation.port, "127.0.0.1");
				await once(probe, "listening");
				await new Promise<void>((resolve) => probe.close(() => resolve()));
			} finally {
				process.child.kill("SIGKILL");
			}
		}
		assert.deepEqual(await readFile(join(root, ".git/index")), index);
		assert.equal(await readFile(join(root, "tracked"), "utf8"), "second\nextra\n");
		assert.deepEqual(execFileSync("git", ["-C", root, "status", "--porcelain=v1"]), status);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("CLI fails on invalid port, bad policy and occupied port without a success address", async () => {
	const { root, policy } = await fixture();
	const reservation = await reservePort();
	try {
		for (const port of ["invalid", String(reservation.port)]) {
			const process = run(["serve", "--workspace", root], { ZD_AI_FORGE_PORT: port });
			try {
				assert.equal((await bounded(process.exited)).code, 1);
				assert.equal(process.stdout(), "");
				assert.ok(process.stderr().length > 0);
			} finally {
				process.child.kill("SIGKILL");
			}
		}
		await writeFile(policy, "export default {};\n");
		const process = run(["serve", "--workspace", root], { ZD_AI_FORGE_PORT: String(reservation.port) });
		try {
			assert.equal((await bounded(process.exited)).code, 1);
			assert.match(process.stderr(), /WorkspacePolicy/);
			assert.equal(process.stdout(), "");
		} finally {
			process.child.kill("SIGKILL");
		}
	} finally {
		await reservation.close();
		await rm(root, { recursive: true, force: true });
	}
});
