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

test("CLI uses selected .env, serves read-only identity and releases port on signals", async () => {
	const { root } = await fixture();
	try {
		await writeFile(join(root, "tracked"), "original\n");
		execFileSync("git", ["-C", root, "add", "tracked"]);
		const index = await readFile(join(root, ".git/index"));
		const status = execFileSync("git", ["-C", root, "status", "--porcelain=v1"]);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
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
		assert.equal(await readFile(join(root, "tracked"), "utf8"), "original\n");
		// .env is the only fixture change made after taking the status snapshot.
		assert.equal(
			execFileSync("git", ["-C", root, "status", "--porcelain=v1"]).toString().replace("?? .env\n", ""),
			status.toString(),
		);
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
