import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitProcess } from "../../../lib/git/index.ts";
import { loadWorkspacePolicy, resolveRepositories } from "../index.ts";

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

test("loader rejects malformed, duplicate and escaping declaration paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "forge-declarations-"));
	try {
		for (const [index, declarations] of [
			[null],
			[{ path: 1 }],
			[{ path: "/absolute" }],
			[{ path: "../outside" }],
			[{ path: "a/../b" }],
			[{ path: "a//b" }],
			[{ path: "a\\b" }],
			[{ path: "." }, { path: "." }],
		].entries()) {
			const module = join(root, `invalid-${index}.mts`);
			await writeFile(
				module,
				`export default { repositories: ${JSON.stringify(declarations)}, codebasesForChange: () => [] };`,
			);
			await assert.rejects(loadWorkspacePolicy(module), /unique normalized workspace-relative paths/);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
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
