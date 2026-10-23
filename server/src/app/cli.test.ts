import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as {
	version: string;
};
const main = fileURLToPath(new URL("../main.ts", import.meta.url));
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "forge-cli-'\"$-"));
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
			await writeFile(
				join(root, ".env"),
				`ZD_AI_FORGE_PORT=${reservation.port}\nPRIVATE_TOKEN=must-not-appear-in-startup\n`,
			);
			const process = run(["serve", "--workspace", root], { PRIVATE_TOKEN: "must-not-appear-in-startup" });
			try {
				await ready(process);
				const address = `http://127.0.0.1:${reservation.port}`;
				assert.equal(
					process.stdout(),
					`Forge @zdreamer/forge ${manifest.version}\nExecutable: ${JSON.stringify(main)}\nWorkspace: ${JSON.stringify(root)}\n${address}\n`,
				);
				const response = await fetch(`${address}/api/workspace`);
				assert.equal(response.status, 200);
				assert.deepEqual(await response.json(), {
					workspace: { root, name: basename(root) },
					repositories: [
						{ path: ".", status: "available", gitRoot: root },
						{ path: "absent", status: "missing" },
					],
				});
				const page = await fetch(address);
				assert.equal(page.status, 200);
				assert.match(await page.text(), /<script>/);
				const pageHead = await fetch(address, { method: "HEAD" });
				assert.equal(pageHead.status, 200);
				assert.equal(await pageHead.text(), "");
				assert.equal((await fetch(`${address}/unknown`)).status, 404);
				assert.equal((await fetch(address, { method: "POST" })).status, 405);
				assert.equal((await fetch(address, { headers: { origin: "http://foreign" } })).status, 403);
				const foreignStatus = await new Promise<number | undefined>((resolve, reject) => {
					const probe = request(address, { headers: { host: "foreign" } }, (response) => {
						response.resume();
						resolve(response.statusCode);
					});
					probe.on("error", reject);
					probe.end();
				});
				assert.equal(foreignStatus, 403);
				const change = () => ({
					repo: ".",
					path: "tracked",
					kind: "modified",
					codebases: [],
				});
				assert.deepEqual(await (await fetch(`${address}/api/changes`)).json(), { codebases: {}, changes: [change()] });
				await writeFile(join(root, "tracked"), "second\nextra\n");
				assert.deepEqual(await (await fetch(`${address}/api/changes`)).json(), { codebases: {}, changes: [change()] });
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

test("CLI shares active GET/HEAD work and shutdown reaps a TERM-resistant Git child", { timeout: 10000 }, async () => {
	const { root } = await fixture();
	const tools = await mkdtemp(join(tmpdir(), "forge-cli-git-"));
	const marker = join(tools, "pid");
	const count = join(tools, "count");
	const executable = join(tools, "git");
	const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
	await writeFile(
		executable,
		`#!${process.execPath}\nimport {writeFileSync, appendFileSync} from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args.includes('diff')) { process.on('SIGTERM',()=>{}); appendFileSync(${JSON.stringify(count)}, 'diff\\n'); writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(()=>{},1000); }\nelse {const result=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(result.status ?? 1);}\n`,
	);
	await chmod(executable, 0o755);
	const reservation = await reservePort();
	await reservation.close();
	const server = run(["serve", "--workspace", root], {
		PATH: `${tools}:${process.env.PATH}`,
		ZD_AI_FORGE_PORT: String(reservation.port),
	});
	let pid: number | undefined;
	try {
		await ready(server);
		const address = server.stdout().trim().split("\n").at(-1);
		assert.ok(address);
		const firstClient = new AbortController();
		const first = fetch(`${address}/api/changes`, { signal: firstClient.signal }).catch(() => undefined);
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				pid = Number(await readFile(marker, "utf8"));
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		assert.ok(pid, "diff child started");
		const childPid = pid;
		const head = fetch(`${address}/api/changes`, { method: "HEAD" }).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 100));
		firstClient.abort();
		await first;
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(await readFile(count, "utf8"), "diff\n");
		assert.doesNotThrow(() => process.kill(childPid, 0), "one client disconnect leaves shared collection alive");
		server.child.kill("SIGTERM");
		assert.deepEqual(await bounded(server.exited), { code: 0, signal: null });
		await head;
		assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
		const probe = createServer();
		probe.listen(reservation.port, "127.0.0.1");
		await once(probe, "listening");
		await new Promise<void>((resolve) => probe.close(() => resolve()));
	} finally {
		server.child.kill("SIGKILL");
		if (pid) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
		}
		await Promise.all([rm(root, { recursive: true, force: true }), rm(tools, { recursive: true, force: true })]);
	}
});
