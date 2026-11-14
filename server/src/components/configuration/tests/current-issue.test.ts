import assert from "node:assert/strict";
import fs, { mkdir, mkdtemp, readdir, readFile, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigurationError, type ConfigurationRead, createConfiguration } from "../index.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), "forge-current-issue-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const locations = {
		workspaceRoot: join(root, "workspace"),
		userConfigDirectory: join(root, "user"),
		guidanceDirectory: join(root, "external-guide"),
	};
	await mkdir(locations.workspaceRoot);
	await mkdir(locations.guidanceDirectory);
	const state = join(locations.guidanceDirectory, ".local", "state.json");
	return { root, locations, state, lock: `${state}.lock` };
}

function value<T>(read: ConfigurationRead<T>): T {
	if (!read.available) throw new Error(read.diagnostic);
	return read.value;
}

async function contents(path: string) {
	return JSON.parse(await readFile(path, "utf8"));
}

test("selection writes honor external guides, preserve literal unrelated keys, and reread fresh state", async (t) => {
	const f = await fixture(t);
	await mkdir(join(f.locations.guidanceDirectory, ".local"));
	await writeFile(
		f.state,
		'{"__proto__":{"safe":true},"constructor":2,"current_issue":{"directory":"stale","old":true}}',
	);
	const owner = await createConfiguration(f.locations);
	assert.equal(value(owner.readCurrentIssue()), join(f.locations.workspaceRoot, "stale"));
	await writeFile(
		f.state,
		'{"__proto__":{"safe":true},"constructor":2,"fresh":3,"current_issue":{"directory":"other"}}',
	);
	await owner.writeCurrentIssue("plans/new");
	assert.deepEqual(
		await contents(f.state),
		JSON.parse('{"__proto__":{"safe":true},"constructor":2,"fresh":3,"current_issue":{"directory":"plans/new"}}'),
	);
	assert.equal(value(owner.readCurrentIssue()), join(f.locations.workspaceRoot, "plans/new"));
	assert.equal(owner.readCurrentIssue().source.provenance, "file");
	assert.equal(await readFile(join(f.locations.guidanceDirectory, ".local", ".gitignore"), "utf8"), "*\n");
	assert.deepEqual((await readdir(join(f.locations.guidanceDirectory, ".local"))).sort(), [".gitignore", "state.json"]);
	await owner.writeCurrentIssue(f.locations.workspaceRoot);
	assert.deepEqual((await contents(f.state)).current_issue, { directory: "." });
	await owner.writeCurrentIssue(join(f.root, "outside"));
	assert.deepEqual((await contents(f.state)).current_issue, { directory: join(f.root, "outside") });
});

test("stored directories resolve symlinks before parent segments, including nonexistent targets", async (t) => {
	const f = await fixture(t);
	await mkdir(join(f.root, "outside"));
	await symlink(join(f.root, "outside", "missing"), join(f.locations.workspaceRoot, "link"));
	const owner = await createConfiguration(f.locations);
	await owner.writeCurrentIssue("link/../selected");
	assert.equal(value(owner.readCurrentIssue()), join(f.root, "outside", "selected"));
	assert.equal((await contents(f.state)).current_issue.directory, join(f.root, "outside", "selected"));
	await writeFile(f.state, JSON.stringify({ current_issue: { directory: "link/../selected" } }));
	await owner.reload();
	assert.equal(value(owner.readCurrentIssue()), join(f.root, "outside", "selected"));
});

test("selection writes preserve unrelated large integers and precise numeric tokens", async (t) => {
	const f = await fixture(t);
	await mkdir(join(f.locations.guidanceDirectory, ".local"));
	await writeFile(
		f.state,
		'{"counter":9007199254740993,"nested":{"":-9007199254740993,"values":[1.234567890123456789,1e400,1e-400]},"current_issue":{"directory":"old"}}',
	);
	const owner = await createConfiguration(f.locations);
	await owner.writeCurrentIssue("new");
	const written = await readFile(f.state, "utf8");
	for (const token of ["9007199254740993", "-9007199254740993", "1.234567890123456789", "1e400", "1e-400"])
		assert.ok(written.includes(token), `Unrelated numeric token changed: ${token}`);
	assert.equal((await contents(f.state)).current_issue.directory, "new");
});

test("stored stale selection beneath an ordinary file remains accepted", async (t) => {
	const f = await fixture(t);
	await writeFile(join(f.locations.workspaceRoot, "ordinary-file"), "contents");
	const owner = await createConfiguration(f.locations);
	await owner.writeCurrentIssue("ordinary-file/stale-selection");
	assert.equal(value(owner.readCurrentIssue()), join(f.locations.workspaceRoot, "ordinary-file/stale-selection"));
	assert.equal((await owner.reload()).concerns.currentIssue.status, "accepted");
});

for (const text of [
	"null",
	"42",
	"true",
	"[]",
	"",
	'{"current_issue":null}',
	'{"current_issue":{}}',
	'{"current_issue":{"directory":3}}',
	'{"current_issue":3}',
	'{"current_issue":{"directory":" "}}',
]) {
	test(`invalid state rejects reads and writes without replacing ${JSON.stringify(text)}`, async (t) => {
		const f = await fixture(t);
		await mkdir(join(f.locations.guidanceDirectory, ".local"));
		await writeFile(f.state, text);
		const owner = await createConfiguration(f.locations);
		assert.equal(owner.readCurrentIssue().available, false);
		await assert.rejects(owner.writeCurrentIssue("new"), ConfigurationError);
		assert.equal(await readFile(f.state, "utf8"), text);
		assert.deepEqual(await readdir(join(f.locations.guidanceDirectory, ".local")), ["state.json"]);
		await writeFile(f.state, "{}");
		await owner.writeCurrentIssue("new");
		assert.equal(value(owner.readCurrentIssue()), join(f.locations.workspaceRoot, "new"));
	});
}

test("initialization and reload do not acquire a lock or create local storage", async (t) => {
	const f = await fixture(t);
	const owner = await createConfiguration(f.locations);
	await owner.reload();
	assert.deepEqual(await readdir(f.locations.guidanceDirectory), []);
	await mkdir(join(f.locations.guidanceDirectory, ".local"));
	await mkdir(f.lock);
	assert.equal((await owner.reload()).concerns.currentIssue.status, "accepted");
	assert.equal(value(owner.readCurrentIssue()), undefined);
});

test("stale lock times out within a bounded wait and is left for manual recovery", async (t) => {
	const f = await fixture(t);
	const owner = await createConfiguration(f.locations);
	await mkdir(join(f.locations.guidanceDirectory, ".local"));
	await mkdir(f.lock);
	const started = performance.now();
	await assert.rejects(
		owner.writeCurrentIssue("new"),
		(error: unknown) =>
			error instanceof ConfigurationError && error.message.includes(f.lock) && error.message.includes("manually"),
	);
	assert.ok(performance.now() - started >= 1950);
	assert.ok(performance.now() - started < 3500);
	assert.equal(value(owner.readCurrentIssue()), undefined);
	assert.deepEqual(await readdir(join(f.locations.guidanceDirectory, ".local")), ["state.json.lock"]);
});

test("atomic replacement failure cleans temporary files and lock without publishing selection", async (t) => {
	const f = await fixture(t);
	const owner = await createConfiguration(f.locations);
	await owner.writeCurrentIssue("old");
	const accepted = owner.readCurrentIssue();
	const before = await readFile(f.state, "utf8");
	t.mock.method(fs, "rename", async () => {
		throw new Error("injected rename failure");
	});
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	await assert.rejects(owner.writeCurrentIssue("new"), ConfigurationError);
	assert.equal(await readFile(f.state, "utf8"), before);
	assert.equal(owner.readCurrentIssue(), accepted);
	assert.deepEqual((await readdir(join(f.locations.guidanceDirectory, ".local"))).sort(), [".gitignore", "state.json"]);
});

test("queued reloads and writes preserve operation order and reread after contention", async (t) => {
	const f = await fixture(t);
	const owner = await createConfiguration(f.locations);
	await owner.writeCurrentIssue("old");
	await mkdir(f.lock);
	let signalWaiting: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		signalWaiting = resolve;
	});
	const originalMkdir = fs.mkdir;
	t.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {
		try {
			return await Reflect.apply(originalMkdir, fs, args);
		} catch (error) {
			if (String(args[0]) === f.lock && error instanceof Error && "code" in error && error.code === "EEXIST")
				signalWaiting();
			throw error;
		}
	});
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	});
	const first = owner.writeCurrentIssue("first");
	await waiting;
	assert.equal(value(owner.readCurrentIssue()), join(f.locations.workspaceRoot, "old"));
	const reload = owner.reload();
	const second = owner.writeCurrentIssue("second");
	await writeFile(f.state, JSON.stringify({ fresh: { retained: true }, current_issue: { directory: "external" } }));
	await rmdir(f.lock);
	await Promise.all([first, reload, second]);
	assert.equal(value(owner.readCurrentIssue()), join(f.locations.workspaceRoot, "second"));
	assert.deepEqual(await contents(f.state), { fresh: { retained: true }, current_issue: { directory: "second" } });
});
