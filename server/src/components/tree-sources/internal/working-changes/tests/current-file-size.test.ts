import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { createGitProcess } from "../../../../../lib/git/index.ts";
import { resolveRepositories } from "../../../../workspace-repositories/index.ts";
import { createWorkspaceTree } from "../../../../workspace-tree/index.ts";
import { createWorkingChanges } from "../index.ts";

const env = { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
function git(root: string, ...args: string[]) {
	return execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
}
async function fixture(t: TestContext, paths = ["."]) {
	const directory = await mkdtemp(join(tmpdir(), "forge-size-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, "checkout");
	await mkdir(root);
	git(root, "init", "-q");
	await mkdir(join(root, "folder"));
	await writeFile(join(root, "folder", "literal #\n.md"), "€\n");
	await writeFile(join(root, "plain.md"), "abc");
	const process = createGitProcess(env);
	const service = createWorkingChanges({
		root,
		codebases: [],
		git: process,
		repositories: await resolveRepositories(
			root,
			paths.map((path) => ({ path })),
			process,
		),
	});
	const tree = await service.collect();
	const file = tree.nodes.get("folder/literal #\n.md");
	assert.ok(file);
	return { root, directory, service, tree, file };
}

test("current size observes metadata bytes lazily and accepts literal paths without changing Git state", async (t) => {
	const { root, service, tree, file } = await fixture(t);
	const head = await readFile(join(root, ".git", "HEAD"));
	assert.equal(await service.currentByteSize(tree, file), 4);
	await writeFile(join(root, file.path), "longer");
	assert.equal(await service.currentByteSize(tree, file), 6);
	assert.deepEqual(await readFile(join(root, ".git", "HEAD")), head);
	const foreign = createWorkspaceTree(tree.context);
	assert.throws(() => foreign.insert({ repo: ".", path: "..", current: { kind: "file" } }));
	await assert.rejects(service.currentByteSize(foreign, file));
	await assert.rejects(service.currentByteSize(tree, { ...file }));
	const folder = tree.nodes.get("folder");
	assert.ok(folder);
	await assert.rejects(service.currentByteSize(tree, folder));
});

test("size rejects missing/nonregular leaves, symlink leaves and ancestors, and aborts before Git work", async (t) => {
	const { root, directory, service, tree, file } = await fixture(t);
	await rm(join(root, file.path));
	await assert.rejects(service.currentByteSize(tree, file));
	await mkdir(join(root, file.path));
	await assert.rejects(service.currentByteSize(tree, file));
	await rm(join(root, file.path), { recursive: true });
	await symlink(join(root, "plain.md"), join(root, file.path));
	await assert.rejects(service.currentByteSize(tree, file));
	await rm(join(root, file.path));
	await rename(join(root, "folder"), join(directory, "outside"));
	await writeFile(join(directory, "outside", "literal #\n.md"), "outside");
	await symlink(join(directory, "outside"), join(root, "folder"));
	await assert.rejects(service.currentByteSize(tree, file));
	const controller = new AbortController();
	controller.abort(new Error("cancelled size"));
	await assert.rejects(service.currentByteSize(tree, file, controller.signal), /cancelled size/);
});

test("size rejects newly introduced undeclared clones and missing declared participants", async (t) => {
	const { root, service, tree, file } = await fixture(t, [".", "missing"]);
	git(join(root, "folder"), "init", "-q");
	await assert.rejects(service.currentByteSize(tree, file), /repository boundary/);
	const missing = tree.insert({ repo: ".", path: "missing/test.md", current: { kind: "file" } });
	await mkdir(join(root, "missing"));
	await writeFile(join(root, "missing", "test.md"), "outside participation");
	await assert.rejects(service.currentByteSize(tree, missing));
	const internals = tree.insert({ repo: ".", path: ".git/HEAD", current: { kind: "file" } });
	await assert.rejects(service.currentByteSize(tree, internals));
});

test("size supports a containing Git root and rejects changed participant identity", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "forge-size-parent-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	git(directory, "init", "-q");
	const root = join(directory, "workspace");
	await mkdir(root);
	await writeFile(join(root, "file.md"), "abc");
	const process = createGitProcess(env);
	const service = createWorkingChanges({
		root,
		codebases: [],
		git: process,
		repositories: await resolveRepositories(root, [{ path: "." }], process),
	});
	const tree = await service.collect();
	const file = tree.nodes.get("file.md");
	assert.ok(file);
	assert.equal(await service.currentByteSize(tree, file), 3);
	git(root, "init", "-q");
	await assert.rejects(service.currentByteSize(tree, file), /Git root changed/);
});

test("size retains declared child ownership and fails when its checkout disappears", async (t) => {
	const { root } = await fixture(t);
	const child = join(root, "child");
	await mkdir(child);
	git(child, "init", "-q");
	await writeFile(join(child, "owned.md"), "child bytes");
	const process = createGitProcess(env);
	const service = createWorkingChanges({
		root,
		codebases: [],
		git: process,
		repositories: await resolveRepositories(root, [{ path: "." }, { path: "child" }], process),
	});
	const tree = await service.collect();
	const file = tree.nodes.get("child/owned.md");
	assert.ok(file);
	assert.equal(await service.currentByteSize(tree, file), 11);
	await rm(join(child, ".git"), { recursive: true });
	await assert.rejects(service.currentByteSize(tree, file), /Git root changed/);
	await rm(child, { recursive: true });
	await assert.rejects(service.currentByteSize(tree, file));
});

test("size rechecks cancellation after the async identity probe before observing the leaf", async (t) => {
	const { root } = await fixture(t);
	const process = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], process);
	const controller = new AbortController();
	let sizing = false;
	const service = createWorkingChanges({
		root,
		codebases: [],
		repositories,
		git: async (cwd, args, options) => {
			const result = await process(cwd, args, options);
			if (sizing) {
				assert.deepEqual(args, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
				await rm(join(root, "plain.md"));
				controller.abort(new Error("cancelled during size"));
			}
			return result;
		},
	});
	const tree = await service.collect();
	const file = tree.nodes.get("plain.md");
	assert.ok(file);
	sizing = true;
	await assert.rejects(service.currentByteSize(tree, file, controller.signal), /cancelled during size/);
});
