import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { start } from "./startup.ts";

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
	const policyPath = join(root, "docs/forge/workspace/workspace.ts");
	await writeFile(policyPath, "export default { repositories: [{ path: '.' }], codebasesForChange: () => [] };");
	return {
		directory,
		root,
		policyPath,
		options: { workspace: root, cwd: directory, env: { ZD_AI_FORGE_PORT: String(await availablePort()) } },
	};
}

function signalListeners() {
	return { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };
}

test("startup loads one policy and publishes an ordered repository snapshot without per-request effects", async (t) => {
	const input = await fixture(t);
	for (const name of ["nested", "undeclared"]) {
		execFileSync("git", ["init", "-q", join(input.root, name)]);
	}
	const log = join(input.directory, "imports.txt");
	await writeFile(
		input.policyPath,
		`import { appendFile } from 'node:fs/promises';
await appendFile(${JSON.stringify(log)}, ${JSON.stringify("loaded\n")});
export default {
 repositories: [{path:'nested'}, {path:'absent'}, {path:'.'}],
 codebasesForChange() { throw new Error('Identity must not route changes'); }
};`,
	);
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
		assert.deepEqual(await response.json(), { workspace: { root: await realpath(input.root) }, repositories });
		await rm(join(input.root, "nested"), { recursive: true, force: true });
	}
	assert.equal(await readFile(log, "utf8"), "loaded\n");
	assert.strictEqual(server.close(), server.close());
	await server.close();
	assert.deepEqual(signalListeners(), previous);
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

test("fresh startup reads current policy declarations from its selected checkout", async (t) => {
	for (const missing of ["first", "second"]) {
		const input = await fixture(t);
		await writeFile(
			input.policyPath,
			`export default { repositories: [{ path: '${missing}' }], codebasesForChange: () => [] };`,
		);
		const server = await start(input.options);
		t.after(server.close);
		assert.deepEqual(server.snapshot.repositories, [{ path: missing, status: "missing" }]);
		await server.close();
	}
});

test("policy and repository failures refuse startup before installing termination hooks", async (t) => {
	for (const failure of ["malformed", "import", "nested", "git"] as const) {
		const input = await fixture(t);
		if (failure === "malformed") await writeFile(input.policyPath, "export default {};");
		if (failure === "import") await writeFile(input.policyPath, "import './does-not-exist.ts';");
		if (failure === "nested") {
			await mkdir(join(input.root, "nested"));
			await writeFile(
				input.policyPath,
				"export default { repositories: [{ path: 'nested' }], codebasesForChange: () => [] };",
			);
		}
		if (failure === "git") await rm(join(input.directory, ".git"), { recursive: true });
		const previous = signalListeners();
		await assert.rejects(start(input.options));
		assert.deepEqual(signalListeners(), previous);
	}
});
