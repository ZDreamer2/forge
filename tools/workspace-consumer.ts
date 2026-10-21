import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "forge-consumer-"));
function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
	assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function portReservation(port = 0) {
	const server = createServer();
	try {
		await bounded(
			new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, "127.0.0.1", resolve);
			}),
			"Port reservation",
		);
	} catch (error) {
		server.close();
		throw error;
	}
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return {
		port: address.port,
		close: () =>
			bounded(
				new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				}),
				"Port release",
			),
	};
}

async function foreignHostStatus(address: string, path: string) {
	return bounded(
		new Promise<number | undefined>((resolve, reject) => {
			const request = httpRequest(`${address}${path}`, { headers: { host: "foreign.invalid" } }, (response) => {
				response.resume();
				response.once("end", () => resolve(response.statusCode));
				response.once("error", reject);
			});
			request.once("error", reject);
			request.setTimeout(5000, () => request.destroy(new Error("Host probe timed out")));
			request.end();
		}),
		"Host probe",
	);
}

function snapshot(directory: string, omitGit = false): Record<string, string> {
	const files: Record<string, string> = {};
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (omitGit && entry.name === ".git") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			for (const [name, bytes] of Object.entries(snapshot(path, omitGit))) files[`${entry.name}/${name}`] = bytes;
		} else files[entry.name] = readFileSync(path).toString("base64");
	}
	return files;
}

function sourceState(workspace: string) {
	return {
		files: snapshot(workspace, true),
		repositories: [workspace, join(workspace, "nested")].map((repository) => {
			const git = join(repository, ".git");
			return {
				index: readFileSync(join(git, "index")).toString("base64"),
				head: readFileSync(join(git, "HEAD")).toString("base64"),
				refs: snapshot(join(git, "refs")),
				packedRefs: existsSync(join(git, "packed-refs"))
					? readFileSync(join(git, "packed-refs")).toString("base64")
					: null,
			};
		}),
	};
}

async function installedServer(executable: string, cwd: string, workspace: string, port: number) {
	// Ignore ambient policy and module injection: only the installed package supplies runtime code.
	// biome-ignore lint/style/noProcessEnv: subprocess fixture explicitly sanitizes the inherited execution environment.
	const { NODE_PATH: _nodePath, NODE_OPTIONS: _nodeOptions, ...environment } = process.env;
	const child = spawn(executable, ["serve", "--workspace", workspace], {
		cwd,
		env: { ...environment, ZD_AI_FORGE_WORKSPACE_GUIDE: "", ZD_AI_FORGE_PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let resolveReady: (() => void) | undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	child.stdout.on("data", (data: Buffer) => {
		stdout += data.toString();
		if (stdout.includes(`http://127.0.0.1:${port}\n`)) resolveReady?.();
	});
	child.stderr.on("data", (data: Buffer) => {
		stderr += data.toString();
	});
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	const stop = async (signal: NodeJS.Signals) => {
		if (child.exitCode === null && child.signalCode === null) child.kill(signal);
		return bounded(exited, "Installed server shutdown");
	};
	try {
		await bounded(
			Promise.race([
				ready,
				exited.then(() => {
					throw new Error(`Installed server exited before readiness: ${stderr}`);
				}),
			]),
			"Installed server readiness",
		);
		const manifest = JSON.parse(readFileSync(join(dirname(realpathSync(executable)), "../package.json"), "utf8"));
		assert.equal(
			stdout,
			`Forge @zdreamer/forge ${manifest.version}\nExecutable: ${JSON.stringify(realpathSync(executable))}\nWorkspace: ${JSON.stringify(workspace)}\nhttp://127.0.0.1:${port}\n`,
		);
	} catch (error) {
		await stop("SIGKILL").catch(() => {});
		throw error;
	}
	return { address: `http://127.0.0.1:${port}`, stop, stderr: () => stderr };
}

async function verifyServer(executable: string, consumer: string) {
	const workspace = join(consumer, "fixture");
	mkdirSync(join(workspace, "docs/forge/workspace"), { recursive: true });
	mkdirSync(join(workspace, "nested"));
	writeFileSync(join(workspace, ".gitignore"), "nested/\n.env\n");
	writeFileSync(join(workspace, "tracked.txt"), "original\n");
	writeFileSync(join(workspace, "old.txt"), "rename content\n");
	writeFileSync(join(workspace, "nested/binary.dat"), Buffer.from([0, 1, 2]));
	writeFileSync(
		join(workspace, "docs/forge/workspace/workspace.ts"),
		`export default {
  displayName: 'Fixture <workspace> & "name"',
  repositories: [{path: '.'}, {path: 'nested'}, {path: 'not-cloned'}],
  codebasesForChange: (change) => change.path === 'outside.txt' ? [] : [{id: 'fixture<code>', guidance: 'docs/<guidance>'}],
};\n`,
	);
	for (const repository of [workspace, join(workspace, "nested")]) {
		run("git", ["init", "-q", repository], consumer);
		run("git", ["add", "."], repository);
		run(
			"git",
			["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"],
			repository,
		);
	}
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		const reservation = await portReservation();
		await reservation.close();
		const beforeStartup = sourceState(workspace);
		const server = await installedServer(executable, consumer, workspace, reservation.port);
		const request = (path: string, options: RequestInit = {}) =>
			fetch(`${server.address}${path}`, {
				...options,
				signal: AbortSignal.timeout(5000),
			});
		try {
			assert.deepEqual(sourceState(workspace), beforeStartup);
			const identity = await request("/api/workspace");
			assert.equal(identity.status, 200);
			assert.deepEqual(await identity.json(), {
				workspace: { root: workspace, name: 'Fixture <workspace> & "name"' },
				repositories: [
					{ path: ".", status: "available", gitRoot: workspace },
					{ path: "nested", status: "available", gitRoot: join(workspace, "nested") },
					{ path: "not-cloned", status: "missing" },
				],
			});
			const page = await request("/");
			assert.equal(page.status, 200);
			assert.match(page.headers.get("content-type") ?? "", /text\/html/);
			const html = await page.text();
			assert.match(html, /<button\b/i);
			assert.match(html, /refresh/i);
			assert.match(html, /<script\b/i);
			let scripts = html;
			for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
				const path = match[1];
				assert.ok(path?.startsWith("/") && !path.startsWith("//"));
				assert.ok(path);
				const script = await request(path);
				assert.equal(script.status, 200);
				scripts += await script.text();
			}
			assert.match(scripts, /\/api\/workspace/);
			assert.match(scripts, /\/api\/changes/);
			const head = await request("/", { method: "HEAD" });
			assert.equal(head.status, 200);
			assert.equal(await head.text(), "");
			for (const path of ["/", "/api/workspace", "/api/changes"]) {
				assert.equal((await request(path, { headers: { origin: "https://foreign.invalid" } })).status, 403);
				assert.equal(await foreignHostStatus(server.address, path), 403);
				const unsupported = await request(path, { method: "POST" });
				assert.equal(unsupported.status, 405);
				assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
			}
			const unknown = await request("/unknown");
			assert.equal(unknown.status, 404);
			assert.deepEqual(await unknown.json(), { error: { code: "not_found", message: "Not found" } });
			assert.deepEqual(sourceState(workspace), beforeStartup);
			if (signal === "SIGTERM") {
				assert.deepEqual(await (await request("/api/changes")).json(), { codebases: {}, changes: [] });
				assert.deepEqual(sourceState(workspace), beforeStartup);
				writeFileSync(join(workspace, "tracked.txt"), "staged\n");
				run("git", ["add", "tracked.txt"], workspace);
				writeFileSync(join(workspace, "tracked.txt"), "first\n");
				renameSync(join(workspace, "old.txt"), join(workspace, "renamed.txt"));
				run("git", ["add", "old.txt", "renamed.txt"], workspace);
				writeFileSync(join(workspace, "nested/binary.dat"), Buffer.from([0, 4, 5]));
				writeFileSync(join(workspace, "outside.txt"), "no membership\n");
				const edited = sourceState(workspace);
				const response = await request("/api/changes");
				assert.equal(response.status, 200);
				const { codebases, changes } = (await response.json()) as {
					codebases: Record<string, { guidance: string }>;
					changes: Record<string, unknown>[];
				};
				assert.deepEqual(codebases, { "fixture<code>": { guidance: "docs/<guidance>" } });
				assert.equal(changes.length, 4);
				for (const change of changes) {
					assert.equal("binary" in change, false);
					assert.equal("addedLines" in change, false);
					assert.equal("removedLines" in change, false);
				}
				assert.ok(
					changes.some(
						(change) =>
							change.repo === "." &&
							change.path === "renamed.txt" &&
							change.kind === "renamed" &&
							change.from === "old.txt",
					),
				);
				assert.ok(
					changes.some(
						(change) => change.repo === "nested" && change.path === "nested/binary.dat" && change.kind === "modified",
					),
				);
				assert.deepEqual(changes.find((change) => change.path === "outside.txt")?.codebases, []);
				assert.deepEqual(changes.find((change) => change.path === "tracked.txt")?.codebases, ["fixture<code>"]);
				assert.deepEqual(sourceState(workspace), edited);
				writeFileSync(join(workspace, "tracked.txt"), "second\nextra\n");
				const refreshed = sourceState(workspace);
				const fresh = (await (await request("/api/changes")).json()) as { changes: Record<string, unknown>[] };
				assert.equal(fresh.changes.find((change) => change.path === "tracked.txt")?.kind, "modified");
				assert.deepEqual(sourceState(workspace), refreshed);
				writeFileSync(join(workspace, "fresh.txt"), "new after refresh\n");
				const withAddition = sourceState(workspace);
				const next = (await (await request("/api/changes")).json()) as { changes: Record<string, unknown>[] };
				assert.equal(next.changes.find((change) => change.path === "fresh.txt")?.kind, "added");
				assert.deepEqual(sourceState(workspace), withAddition);
			}
			const beforeShutdown = sourceState(workspace);
			assert.deepEqual(await server.stop(signal), { code: 0, signal: null }, server.stderr());
			assert.deepEqual(sourceState(workspace), beforeShutdown);
			const released = await portReservation(reservation.port);
			await released.close();
		} finally {
			await server.stop("SIGKILL");
		}
	}
}

try {
	// Build explicitly: installation/packing never executes package lifecycle scripts.
	run("corepack", ["pnpm", "--config.verify-deps-before-run=error", "run", "build"], root);
	const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root));
	const consumer = join(temporary, "consumer");
	mkdirSync(consumer);
	writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--save-dev",
			"--save-exact",
			join(temporary, packed[0].filename),
		],
		consumer,
	);
	const installed = join(consumer, "node_modules/@zdreamer/forge");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const installedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
	assert.equal(installedManifest.name, manifest.name);
	assert.equal(installedManifest.version, manifest.version);
	assert.equal(installedManifest.license, "MIT");
	assert.match(readFileSync(join(installed, "LICENSE"), "utf8"), /MIT License/);
	assert.ok(
		packed[0].files.every((file: { path: string }) => /^(dist\/|package.json$|README.md$|LICENSE$)/.test(file.path)),
	);
	const policy = join(consumer, "workspace.ts");
	writeFileSync(
		policy,
		`import type { WorkspaceChange, WorkspacePolicy } from '@zdreamer/forge/workspace';
const kinds: WorkspaceChange['kind'][] = ['added', 'modified', 'deleted', 'renamed'];
// @ts-expect-error copy detection is outside the public change vocabulary.
kinds.push('copied');
// @ts-expect-error mode/type transitions use modified.
kinds.push('type_changed');
// @ts-expect-error an explicit display name must be a string.
export const invalidName: WorkspacePolicy['displayName'] = 123;
export default {
  displayName: 'Example workspace',
  repositories: [{ path: '.' }, { path: 'not-cloned' }],
  codebasesForChange: () => [{ id: 'example', guidance: 'docs/code' }],
} satisfies WorkspacePolicy;
`,
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2024",
				lib: ["ES2024"],
				module: "NodeNext",
				types: [],
			},
			include: ["workspace.ts"],
		}),
	);
	const compiler = join(root, "node_modules/.bin/tsc");
	run(compiler, ["--project", consumer], consumer);
	const executable = join(consumer, "node_modules/.bin/forge");
	assert.deepEqual(JSON.parse(run(executable, ["inspect-workspace", policy, ".", "example.ts"], consumer)), {
		included: true,
		codebases: [{ id: "example", guidance: "docs/code" }],
	});
	await verifyServer(executable, consumer);
	writeFileSync(
		policy,
		"import type { WorkspacePolicy } from '@zdreamer/forge/workspace';\nexport default { repositories: [{path: 123}], codebasesForChange: () => [] } satisfies WorkspacePolicy;\n",
	);
	const invalid = spawnSync(compiler, ["--project", consumer], { cwd: consumer, encoding: "utf8", timeout: 30_000 });
	assert.notEqual(invalid.status, 0);
	assert.match(invalid.stdout, /not assignable to type 'string'/);
	if (process.argv[2] !== undefined) {
		copyFileSync(resolve(process.argv[2]), policy);
		run(compiler, ["--project", consumer], consumer);
		JSON.parse(run(executable, ["inspect-workspace", policy, ".", "package.json"], consumer));
	}
	console.log(
		"Tarball-only consumer: installed server/page, fresh read-only multirepo changes, protection, shutdown, public types, diagnostic and optional workspace module passed.",
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
