import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitProcess } from "../../../lib/git/index.ts";
import { createScope, type RepositoryResolution, repositoryExclusions, resolveRepositories } from "../index.ts";

const git = createGitProcess({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "forge-repositories-"));
	execFileSync("git", ["init", "-q", root]);
	return root;
}

test("probes declared repositories, tolerates missing ones and never scans undeclared clones", async () => {
	const root = await fixture();
	try {
		for (const name of ["declared", "undeclared"]) {
			execFileSync("git", ["init", "-q", join(root, name)]);
		}
		const results = await resolveRepositories(root, [{ path: "." }, { path: "absent" }, { path: "declared" }], git);
		assert.deepEqual(results, [
			{ path: ".", status: "available", gitRoot: await realpath(root) },
			{ path: "absent", status: "missing" },
			{ path: "declared", status: "available", gitRoot: await realpath(join(root, "declared")) },
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("main repository may extend above the workspace but nested declarations cannot fall back to it", async () => {
	const parent = await fixture();
	try {
		const root = join(parent, "workspace");
		await mkdir(join(root, "not-a-repo"), { recursive: true });
		assert.deepEqual(await resolveRepositories(root, [{ path: "." }], git), [
			{ path: ".", status: "available", gitRoot: await realpath(parent) },
		]);
		await assert.rejects(resolveRepositories(root, [{ path: "not-a-repo" }], git), /another Git root/);
		await writeFile(join(root, "file"), "not a directory");
		await assert.rejects(resolveRepositories(root, [{ path: "file" }], git), /not a directory/);
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

test("startup rejects unrelated core.worktree roots and preserves trailing whitespace", async () => {
	const root = await fixture();
	const other = await fixture();
	try {
		execFileSync("git", ["-C", root, "config", "core.worktree", other]);
		await assert.rejects(resolveRepositories(root, [{ path: "." }], git), /does not contain workspace/);
		const spaced = join(root, "space ");
		execFileSync("git", ["init", "-q", spaced]);
		assert.deepEqual(await resolveRepositories(spaced, [{ path: "." }], git), [
			{ path: ".", status: "available", gitRoot: await realpath(spaced) },
		]);
	} finally {
		await Promise.all([rm(root, { recursive: true, force: true }), rm(other, { recursive: true, force: true })]);
	}
});

test("fresh collection scopes observe added and removed undeclared boundaries without traversing symlinks", async () => {
	const root = await fixture();
	try {
		await mkdir(join(root, "folder"));
		await writeFile(join(root, "folder/file"), "content");
		const before = createScope(root, root, root, []);
		assert.equal(await before("folder/file"), true);
		await mkdir(join(root, "folder/.git"));
		assert.equal(await createScope(root, root, root, [])("folder/file"), false);
		await rm(join(root, "folder/.git"), { recursive: true });
		assert.equal(await createScope(root, root, root, [])("folder/file"), true);
		await symlink("folder", join(root, "link"));
		assert.equal(await createScope(root, root, root, [])("link"), true);
		assert.equal(await createScope(root, root, root, [])("folder/.GiT/config"), false);
		assert.equal(await createScope(root, root, root, [join(root, "folder")])("folder/file"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("exclusions retain declared locations and canonical roots without excluding the participant itself", () => {
	const repositories: RepositoryResolution[] = [
		{ path: ".", status: "available", gitRoot: "/parent" },
		{ path: "alias", status: "available", gitRoot: "/parent/workspace/actual" },
		{ path: "alias/missing", status: "missing" },
		{ path: "absent", status: "missing" },
		{ path: "sibling", status: "available", gitRoot: "/parent/workspace/sibling" },
	];
	assert.deepEqual(repositoryExclusions("/parent/workspace", ".", "/parent/workspace", repositories), [
		"/parent/workspace/alias",
		"/parent/workspace/actual",
		"/parent/workspace/alias/missing",
		"/parent/workspace/absent",
		"/parent/workspace/sibling",
	]);
	assert.deepEqual(repositoryExclusions("/parent/workspace", "alias", "/parent/workspace/actual", repositories), [
		"/parent/workspace/actual/missing",
	]);
	assert.deepEqual(repositoryExclusions("/parent/workspace", "sibling", "/parent/workspace/sibling", repositories), []);
});

test("computed exclusions keep missing children separate through a declared alias", async () => {
	const root = await fixture();
	try {
		const actual = join(root, "actual");
		execFileSync("git", ["init", "-q", actual]);
		await symlink(actual, join(root, "alias"));
		const repositories = await resolveRepositories(root, [{ path: "alias" }, { path: "alias/missing" }], git);
		// A missing-at-startup child stays excluded even if ordinary files later appear there.
		await mkdir(join(actual, "missing"));
		await writeFile(join(actual, "missing/file"), "not part of the parent");
		await writeFile(join(actual, "ordinary"), "part of the parent");
		const exclusions = repositoryExclusions(root, "alias", actual, repositories);
		const scope = createScope(actual, root, actual, exclusions);
		assert.equal(await scope("missing/file"), false);
		assert.equal(await scope("ordinary"), true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("startup rejects repository aliases escaping the workspace and preserves declared in-workspace aliases", async () => {
	const root = await fixture();
	const outside = await fixture();
	try {
		execFileSync("git", ["init", "-q", join(root, "nested")]);
		await symlink(outside, join(root, "outside"));
		await assert.rejects(resolveRepositories(root, [{ path: "outside" }], git), /escapes workspace/);
		await symlink(join(root, "nested"), join(root, "alias"));
		assert.deepEqual(await resolveRepositories(root, [{ path: "alias" }, { path: "alias/missing" }], git), [
			{ path: "alias", status: "available", gitRoot: await realpath(join(root, "nested")) },
			{ path: "alias/missing", status: "missing" },
		]);
	} finally {
		await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
	}
});
