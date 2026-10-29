import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { WorkspaceAnalysis, WorkspaceChanges } from "../../components/api-contract/index.ts";
import { start } from "../startup.ts";

async function availablePort(): Promise<number> {
	const socket = createServer();
	await new Promise<void>((resolve, reject) => {
		socket.once("error", reject);
		socket.listen(0, "127.0.0.1", resolve);
	});
	const address = socket.address();
	assert.ok(address && typeof address !== "string");
	await new Promise<void>((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
	return address.port;
}

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "forge-startup-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", directory]);
	const root = join(directory, "workspace");
	await mkdir(join(root, "docs/forge/workspace"), { recursive: true });
	const configPath = join(root, "docs/forge/workspace/forge-workspace.yaml");
	await writeFile(configPath, "repositories: ['.']\ncodebases: []\ncodebase_types: []\n");
	return {
		directory,
		root,
		configPath,
		options: { workspace: root, cwd: directory, env: { ZD_AI_FORGE_PORT: String(await availablePort()) } },
	};
}

function signalListeners() {
	return { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };
}

test("startup loads one configuration and publishes an ordered repository snapshot without per-request effects", async (t) => {
	const input = await fixture(t);
	for (const name of ["nested", "undeclared"]) {
		execFileSync("git", ["init", "-q", join(input.root, name)]);
	}
	await writeFile(input.configPath, "repositories: [nested, absent, '.']\ncodebases: []\ncodebase_types: []\n");
	const previous = signalListeners();
	const server = await start(input.options);
	t.after(server.close);
	const repositories = [
		{ path: "nested", status: "available", gitRoot: await realpath(join(input.root, "nested")) },
		{ path: "absent", status: "missing" },
		{ path: ".", status: "available", gitRoot: await realpath(input.directory) },
	];
	assert.equal(server.snapshot.root, await realpath(input.root));
	assert.deepEqual(server.snapshot.repositories, repositories);
	assert.equal(Object.isFrozen(server.snapshot), true);
	assert.equal(process.listenerCount("SIGINT"), previous.SIGINT.length + 1);
	assert.equal(process.listenerCount("SIGTERM"), previous.SIGTERM.length + 1);
	for (let request = 0; request < 2; request++) {
		const response = await fetch(`${server.address}/api/workspace`);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			workspace: { root: await realpath(input.root), name: "workspace" },
			repositories,
		});
		await rm(join(input.root, "nested"), { recursive: true, force: true });
	}
	assert.strictEqual(server.close(), server.close());
	await server.close();
	assert.deepEqual(signalListeners(), previous);
});

test("socket requests collect fresh changes with startup routing and fail safely after repository loss", async (t) => {
	const input = await fixture(t);
	const nested = join(input.root, "nested");
	execFileSync("git", ["init", "-q", nested]);
	await mkdir(join(input.root, "guidance"));
	await mkdir(join(nested, "guidance"));
	await writeFile(join(input.root, "guidance/forge-codebase.yaml"), "root: ..\n");
	await writeFile(join(nested, "guidance/forge-codebase.yaml"), "root: ..\n");
	await writeFile(
		input.configPath,
		"repositories: [nested, absent, '.']\ncodebases: [../../../guidance/forge-codebase.yaml, ../../../nested/guidance/forge-codebase.yaml]\ncodebase_types: []\n",
	);
	await writeFile(join(input.root, ".gitignore"), "docs/\nguidance/\nnested/\nabsent/\n");
	await writeFile(join(input.root, "tracked.txt"), "baseline\n");
	await writeFile(join(nested, "child.txt"), "baseline\n");
	for (const directory of [input.directory, nested]) {
		execFileSync("git", ["-C", directory, "add", "."]);
		execFileSync("git", [
			"-C",
			directory,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.com",
			"commit",
			"-qm",
			"baseline",
		]);
	}
	await writeFile(join(input.root, "tracked.txt"), "first\n");
	await writeFile(join(nested, "child.txt"), "child\n");
	const indexes = await Promise.all(
		[input.directory, nested].map((directory) => readFile(join(directory, ".git/index"))),
	);
	const status = execFileSync("git", ["-C", input.directory, "status", "--porcelain=v1"]);
	const server = await start(input.options);
	t.after(server.close);
	const identity = {
		workspace: { root: await realpath(input.root), name: "workspace" },
		repositories: server.snapshot.repositories,
	};
	const expectedChange = (repo: string, path: string) => ({
		repo,
		path,
		kind: "modified",
		codebases: [repo],
	});
	assert.deepEqual(await (await fetch(`${server.address}/api/changes`)).json(), {
		codebases: {
			nested: { root: "nested", guidance: "nested/guidance" },
			".": { root: ".", guidance: "guidance" },
		},
		changes: [expectedChange("nested", "nested/child.txt"), expectedChange(".", "tracked.txt")],
	});
	await writeFile(join(input.root, "tracked.txt"), "second\nextra\n");
	await writeFile(input.configPath, "not: [valid YAML");
	execFileSync("git", ["init", "-q", join(input.root, "absent")]);
	await writeFile(join(input.root, "absent/ignored.txt"), "not a startup participant\n");
	assert.deepEqual(await (await fetch(`${server.address}/api/changes`)).json(), {
		codebases: {
			nested: { root: "nested", guidance: "nested/guidance" },
			".": { root: ".", guidance: "guidance" },
		},
		changes: [expectedChange("nested", "nested/child.txt"), expectedChange(".", "tracked.txt")],
	});
	assert.deepEqual(await (await fetch(`${server.address}/api/workspace`)).json(), identity);
	assert.deepEqual(
		await Promise.all([input.directory, nested].map((directory) => readFile(join(directory, ".git/index")))),
		indexes,
	);
	await rm(join(nested, ".git"), { recursive: true });
	const failed = await fetch(`${server.address}/api/changes`);
	assert.equal(failed.status, 500);
	assert.deepEqual(await failed.json(), { error: { code: "internal_error", message: "Internal server error" } });
	assert.deepEqual(await (await fetch(`${server.address}/api/workspace`)).json(), identity);
	await server.close();
	assert.deepEqual(await readFile(join(input.directory, ".git/index")), indexes[0]);
	assert.equal(await readFile(join(input.root, "tracked.txt"), "utf8"), "second\nextra\n");
	assert.equal(await readFile(join(nested, "child.txt"), "utf8"), "child\n");
	assert.deepEqual(execFileSync("git", ["-C", input.directory, "status", "--porcelain=v1"]), status);
});

test("termination signals dispose the listener and remove both owned signal handlers", async (t) => {
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		const input = await fixture(t);
		const previous = signalListeners();
		const server = await start(input.options);
		t.after(server.close);
		process.emit(signal);
		await server.close();
		assert.deepEqual(signalListeners(), previous);
		await assert.rejects(fetch(`${server.address}/api/workspace`));
	}
});

test("fresh startup reads current configuration declarations from its selected checkout", async (t) => {
	for (const missing of ["first", "second"]) {
		const input = await fixture(t);
		await writeFile(input.configPath, `repositories: [${missing}]\ncodebases: []\ncodebase_types: []\n`);
		const server = await start(input.options);
		t.after(server.close);
		assert.deepEqual(server.snapshot.repositories, [{ path: missing, status: "missing" }]);
		await server.close();
	}
});

test("configuration and repository failures refuse startup before installing termination hooks", async (t) => {
	for (const failure of ["malformed", "import", "nested", "git"] as const) {
		const input = await fixture(t);
		if (failure === "malformed") await writeFile(input.configPath, "repositories: invalid\n");
		if (failure === "import") await writeFile(input.configPath, "not: [valid YAML");
		if (failure === "nested") {
			await mkdir(join(input.root, "nested"));
			await writeFile(input.configPath, "repositories: [nested]\ncodebases: []\ncodebase_types: []\n");
		}
		if (failure === "git") await rm(join(input.directory, ".git"), { recursive: true });
		const previous = signalListeners();
		await assert.rejects(start(input.options));
		assert.deepEqual(signalListeners(), previous);
	}
});

test("startup publishes explicit literal configuration name instead of checkout basename", async (t) => {
	const input = await fixture(t);
	const name = "BiCo <script> & 🛠️";
	await writeFile(
		input.configPath,
		`display_name: ${JSON.stringify(name)}\nrepositories: []\ncodebases: []\ncodebase_types: []\n`,
	);
	const server = await start(input.options);
	t.after(server.close);
	assert.deepEqual(await (await fetch(`${server.address}/api/workspace`)).json(), {
		workspace: { root: await realpath(input.root), name },
		repositories: [],
	});
});

test("startup handler failures affect analysis only and never expose their private cause", async (t) => {
	for (const failure of ["missing", "export", "invoke"] as const) {
		const input = await fixture(t);
		await writeFile(
			input.configPath,
			"repositories: ['.']\ncodebases: []\ncodebase_types: []\nanalysis_handlers: ['./handler.mjs']\n",
		);
		if (failure !== "missing")
			await writeFile(
				join(input.root, "docs/forge/workspace/handler.mjs"),
				failure === "export"
					? "export default 1;"
					: "export default () => { throw new Error('/private/secret detail'); };",
			);
		const server = await start(input.options);
		t.after(server.close);
		const response = await fetch(`${server.address}/api/changes/analysis`);
		assert.equal(response.status, 500);
		const body = (await response.json()) as { error: { code: string; handler: string } };
		assert.equal(body.error.code, "internal_error");
		assert.equal(typeof body.error.handler, "string");
		assert.doesNotMatch(JSON.stringify(body), /private|secret|handler.mjs|stack/);
		assert.equal((await fetch(`${server.address}/api/changes`)).status, 200);
		assert.equal((await fetch(`${server.address}/api/workspace`)).status, 200);
		await server.close();
	}
});

test("invocation diagnostics stay in bounded sanitized server logs, not HTTP errors", async (t) => {
	for (const asynchronous of [false, true]) {
		await t.test(asynchronous ? "async rejection" : "sync throw", async (t) => {
			const input = await fixture(t);
			const diagnostic = `/private/secret detail\n\t\u001b${"x".repeat(2000)}`;
			await writeFile(
				input.configPath,
				"repositories: ['.']\ncodebases: []\ncodebase_types: []\nanalysis_handlers: ['./handler.mjs']\n",
			);
			await writeFile(
				join(input.root, "docs/forge/workspace/handler.mjs"),
				`export default ${asynchronous ? "async " : ""}() => { throw new Error(${JSON.stringify(diagnostic)}); };`,
			);
			const logged = t.mock.method(console, "error", () => {});
			const server = await start(input.options);
			t.after(server.close);
			const response = await fetch(`${server.address}/api/changes/analysis`);
			assert.equal(response.status, 500);
			assert.deepEqual(await response.json(), {
				error: { code: "internal_error", message: "Internal server error", handler: "workspace:1" },
			});
			assert.equal(logged.mock.calls.length, 1);
			const message = logged.mock.calls[0]?.arguments[0];
			assert.equal(typeof message, "string");
			assert.match(
				message,
				/^Forge workspace request failed: Analysis handler failed: workspace:1: \/private\/secret detail {3}x+$/,
			);
			assert.doesNotMatch(message, /\p{Cc}/u);
			assert.equal(message.length, "Forge workspace request failed: ".length + 1600);
			assert.equal((await fetch(`${server.address}/api/changes`)).status, 200);
			await server.close();
		});
	}
});

test("simultaneous analysis runs and light requests remain independent", async (t) => {
	const input = await fixture(t);
	await writeFile(
		input.configPath,
		"repositories: ['.']\ncodebases: []\ncodebase_types: []\nanalysis_handlers: ['./handler.mjs']\n",
	);
	await writeFile(
		join(input.root, "docs/forge/workspace/handler.mjs"),
		"export default async root => { await new Promise(resolve => setTimeout(resolve, 20)); root.notice('one invocation'); };",
	);
	const server = await start(input.options);
	t.after(server.close);
	const [first, second, light] = await Promise.all([
		fetch(`${server.address}/api/changes/analysis`),
		fetch(`${server.address}/api/changes/analysis`),
		fetch(`${server.address}/api/changes`),
	]);
	for (const response of [first, second]) {
		assert.equal(response.status, 200);
		const body = (await response.json()) as WorkspaceAnalysis;
		assert.deepEqual(body.nodes["."]?.signalCounts, { notice: 1, warning: 0 });
		assert.equal(body.nodes["."]?.signals.length, 1);
	}
	assert.equal(light.status, 200);
	assert.equal("nodes" in ((await light.json()) as WorkspaceChanges), false);
});

test("a disconnected analysis client aborts its cooperative handler while light requests remain available", async (t) => {
	const input = await fixture(t);
	const started = join(input.directory, "analysis-started");
	const cancelled = join(input.directory, "analysis-cancelled");
	await writeFile(
		input.configPath,
		"repositories: ['.']\ncodebases: []\ncodebase_types: []\nanalysis_handlers: ['./handler.mjs']\n",
	);
	await writeFile(
		join(input.root, "docs/forge/workspace/handler.mjs"),
		`import { writeFile } from 'node:fs/promises'; export default async root => { await writeFile(${JSON.stringify(started)}, 'started'); await new Promise(resolve => root.signal.addEventListener('abort', resolve, {once:true})); await writeFile(${JSON.stringify(cancelled)}, 'cancelled'); root.signal.throwIfAborted(); };`,
	);
	const server = await start(input.options);
	t.after(server.close);
	const client = new AbortController();
	const request = fetch(`${server.address}/api/changes/analysis`, { signal: client.signal }).catch(() => undefined);
	async function waitFor(path: string) {
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				return await readFile(path, "utf8");
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		throw new Error("Handler observation timed out");
	}
	assert.equal(await waitFor(started), "started");
	client.abort();
	await request;
	assert.equal(await waitFor(cancelled), "cancelled");
	assert.equal((await fetch(`${server.address}/api/changes`)).status, 200);
});
