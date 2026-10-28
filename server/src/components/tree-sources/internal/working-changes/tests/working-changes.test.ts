import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { createGitProcess } from "../../../../../lib/git/index.ts";
import { resolveRepositories } from "../../../../workspace-repositories/index.ts";
import type { WorkspaceTree } from "../../../../workspace-tree/index.ts";

type WorkspaceChange = {
	repo: string;
	path: string;
	kind: "added" | "modified" | "deleted" | "renamed";
	from?: string;
};
function project(tree: WorkspaceTree) {
	return tree.entries.map(({ repo, path, kind, from }) => ({
		repo,
		path,
		kind,
		...(from === undefined ? {} : { from }),
	}));
}

import { createWorkingChanges } from "../index.ts";

const env = {
	PATH: "/usr/bin:/bin",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function git(root: string, ...args: string[]): string {
	return execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function put(root: string, path: string, content: string | Uint8Array) {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), content);
}

function commit(root: string) {
	git(root, "add", "--all");
	git(root, "commit", "-qm", "fixture");
}

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "forge-changes-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, "checkout");
	await mkdir(root);
	git(root, "init", "-q", "--initial-branch=main");
	return { directory, root };
}

async function collector(
	input: { root: string },
	observe: (change: WorkspaceChange) => unknown = () => [],
	paths: readonly string[] = ["."],
	operationalEnv: Readonly<NodeJS.ProcessEnv> = env,
) {
	const service = createWorkingChanges({
		...input,
		repositories: await resolveRepositories(
			input.root,
			paths.map((path) => ({ path })),
			createGitProcess(operationalEnv),
		),
		codebases: [],
		git: createGitProcess(operationalEnv),
	});
	return {
		collect: async (signal?: AbortSignal) => {
			const changes = project(await service.collect(signal));
			for (const item of changes) observe(item as WorkspaceChange);
			return changes;
		},
		collectResult: service.collect,
	};
}

function change(path: string, kind: WorkspaceChange["kind"], extra: Record<string, unknown> = {}) {
	return { repo: ".", path, kind, ...extra };
}

// Include source objects, refs, indexes and working files: Git status must not refresh them.
async function snapshot(root: string): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	async function visit(directory: string, prefix: string) {
		for (const name of (await readdir(directory)).sort()) {
			const path = prefix ? `${prefix}/${name}` : name;
			const location = join(directory, name);
			const stat = await lstat(location);
			if (stat.isSymbolicLink()) result[path] = { target: await readlink(location), mode: stat.mode };
			else if (stat.isDirectory()) await visit(location, path);
			else result[path] = { bytes: (await readFile(location)).toString("base64"), mode: stat.mode };
		}
	}
	await visit(root, "");
	return result;
}

test("compares HEAD to the working tree while respecting hidden index flags and preserving source state", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	for (const name of ["mixed", "reversed", "restored", "assumed", "sparse", "sparse-absent", "deleted"])
		await put(root, name, `${name} baseline\n`);
	await put(root, ".gitignore", "ignored\n");
	commit(root);
	await put(root, "mixed", "intermediate staging\n");
	await put(root, "reversed", "temporary content\n");
	await put(root, "staged-then-removed", "never in final tree\n");
	git(root, "add", "--all");
	await put(root, "mixed", "actual final content\nextra line\n");
	await put(root, "reversed", "reversed baseline\n");
	await rm(join(root, "staged-then-removed"));
	git(root, "rm", "-q", "restored");
	await put(root, "restored", "restored baseline\n");
	git(root, "update-index", "--assume-unchanged", "assumed");
	git(root, "update-index", "--skip-worktree", "sparse", "sparse-absent");
	await put(root, "assumed", "hidden real edit\n");
	await put(root, "sparse", "sparse real edit\n");
	await rm(join(root, "sparse-absent"));
	await rm(join(root, "deleted"));
	await put(root, "untracked", "new content\n");
	await put(root, "ignored", "never included\n");
	const collect = await collector(input);
	const before = await snapshot(root);
	assert.deepEqual(await collect.collect(), [
		change("deleted", "deleted"),
		change("mixed", "modified"),
		change("untracked", "added"),
	]);
	assert.deepEqual(await snapshot(root), before);

	await put(root, "mixed", "mixed baseline\n");
	await rm(join(root, "untracked"));
	const next = await collect.collect();
	assert.equal(
		next.some((entry) => entry.path === "untracked"),
		false,
	);
});

test("reports empty-file additions and deletions", async (t) => {
	const input = await fixture(t);
	const collect = await collector(input);
	await put(input.root, "empty", "");
	assert.deepEqual(await collect.collect(), [change("empty", "added")]);
	git(input.root, "add", "empty");
	const staged = await snapshot(input.root);
	assert.deepEqual(await collect.collect(), [change("empty", "added")]);
	assert.deepEqual(await snapshot(input.root), staged);
	commit(input.root);
	await rm(join(input.root, "empty"));
	const deleted = await snapshot(input.root);
	assert.deepEqual(await collect.collect(), [change("empty", "deleted")]);
	assert.deepEqual(await snapshot(input.root), deleted);
});

test("reconciles content and stat reversals while retaining structural and binary changes in one read-only diff", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	git(root, "config", "core.fileMode", "true");
	for (const name of ["content-reversed", "mode", "mode-reversed", "stat-only"])
		await put(root, name, `${name} baseline\n`);
	await put(root, "binary\tline\nname", Buffer.from([0, 1, 2]));
	await put(root, "empty-deleted", "");
	await put(root, "rename\told\nname", "unique renamed content\n");
	await put(root, "type", "same-target");
	await put(root, ":(glob)*\tline\nname", "old literal content\n");
	commit(root);
	await put(root, "content-reversed", "temporary staged content\n");
	await chmod(join(root, "mode-reversed"), 0o755);
	git(root, "add", "--all");
	await put(root, "content-reversed", "content-reversed baseline\n");
	await chmod(join(root, "mode-reversed"), 0o644);
	// Force stale stat metadata independently of timestamp resolution or racy-clean handling.
	for (const name of ["content-reversed", "mode-reversed", "stat-only"])
		await utimes(join(root, name), new Date("2000-01-01T00:00:00Z"), new Date("2000-01-01T00:00:00Z"));
	await chmod(join(root, "mode"), 0o755);
	await put(root, "binary\tline\nname", Buffer.from([0, 3, 4]));
	await rm(join(root, "empty-deleted"));
	await put(root, "empty-added", "");
	git(root, "mv", "rename\told\nname", "rename\tnew\nname");
	await rm(join(root, "type"));
	await symlink("same-target", join(root, "type"));
	await put(root, ":(glob)*\tline\nname", "new literal content\n");
	for (const [key, value] of [
		["diff.autoRefreshIndex", "true"],
		["diff.ignoreSubmodules", "none"],
		["diff.noprefix", "true"],
		["diff.statGraphWidth", "1"],
		["diff.dirstat", "files,1,cumulative"],
	])
		git(root, "config", key as string, value as string);
	const gitProcess = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], gitProcess);
	const diffs: { args: readonly string[]; stdout: Buffer }[] = [];
	const service = createWorkingChanges({
		root,
		repositories,
		codebases: [],
		git: async (cwd, args, options) => {
			const result = await gitProcess(cwd, args, options);
			if (args[0] === "diff" && args.includes("--raw")) diffs.push({ args, stdout: result.stdout });
			return result;
		},
	});
	const before = await snapshot(root);
	assert.deepEqual(project(await service.collect()), [
		change(":(glob)*\tline\nname", "modified"),
		change("binary\tline\nname", "modified"),
		change("empty-added", "added"),
		change("empty-deleted", "deleted"),
		change("mode", "modified"),
		change("rename\tnew\nname", "renamed", { from: "rename\told\nname" }),
		change("type", "modified"),
	]);
	assert.deepEqual(await snapshot(root), before);
	assert.equal(diffs.length, 1);
	const diff = diffs[0];
	assert.ok(diff);
	for (const flag of ["--raw", "--numstat", "-z"]) assert.ok(diff.args.includes(flag), flag);
	const output = diff.stdout.toString("utf8");
	// These entries really reached the raw stream; the collector must reconcile them with numstat.
	for (const name of ["content-reversed", "mode-reversed", "stat-only"])
		assert.ok(output.includes(` M\0${name}\0`), name);
	assert.ok(output.includes("-\t-\tbinary\tline\nname\0"));
	assert.ok(output.includes("0\t0\t\0rename\told\nname\0rename\tnew\nname\0"));
	assert.ok(output.includes("0\t0\ttype\0"));
});

test("reports symlink and file/directory/type changes without opening referents", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	await put(root, "file-to-directory", "old flat content\n");
	await put(root, "directory-to-file/child", "old child content\n");
	await put(root, "file-to-link", "old regular content\n");
	await symlink("old-target", join(root, "link-to-file"));
	await symlink("previous-missing-target", join(root, "edited-link"));
	await put(root, "ancestor/child", "must disappear without following ancestor\n");
	commit(root);
	await rm(join(root, "file-to-directory"));
	await put(root, "file-to-directory/new-child", "new child content\n");
	await rm(join(root, "directory-to-file"), { recursive: true });
	await put(root, "directory-to-file", "new flat content\n");
	await rm(join(root, "file-to-link"));
	await symlink("/outside/nonexistent/file", join(root, "file-to-link"));
	await rm(join(root, "link-to-file"));
	await put(root, "link-to-file", "new regular content\n");
	await rm(join(root, "edited-link"));
	await symlink("new-missing-target", join(root, "edited-link"));
	const outside = join(input.directory, "outside");
	await mkdir(outside);
	await put(outside, "child", "must never read the referent\n");
	await rm(join(root, "ancestor"), { recursive: true });
	await symlink(outside, join(root, "ancestor"));
	const collect = await collector(input);
	const result = await collect.collect();
	assert.deepEqual(
		result.map(({ path, kind }) => ({ path, kind })),
		[
			{ path: "ancestor", kind: "added" },
			{ path: "ancestor/child", kind: "deleted" },
			{ path: "directory-to-file", kind: "added" },
			{ path: "directory-to-file/child", kind: "deleted" },
			{ path: "edited-link", kind: "modified" },
			{ path: "file-to-directory", kind: "deleted" },
			{ path: "file-to-directory/new-child", kind: "added" },
			{ path: "file-to-link", kind: "modified" },
			{ path: "link-to-file", kind: "modified" },
		],
	);
	assert.deepEqual(
		result.find((entry) => entry.path === "edited-link"),
		change("edited-link", "modified"),
	);
});

test("handles genuinely unborn HEAD and literal unusual filenames", async (t) => {
	const input = await fixture(t);
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), []);
	const names = ["-leading", "space name", "tab\tname", "line\nname", "Юникод", "back\\slash", ":(glob)*"];
	for (const [index, name] of names.entries()) await put(input.root, name, `unique initial ${index}\n`);
	assert.deepEqual(
		await collect.collect(),
		names.toSorted().map((name) => change(name, "added")),
	);
	commit(input.root);
	for (const [index, name] of names.entries()) await put(input.root, name, `unique final ${index}\n`);
	assert.deepEqual(
		await collect.collect(),
		names.toSorted().map((name) => change(name, "modified")),
	);
});

test("sanitizes inherited Git redirection variables rather than using another repository or index", async (t) => {
	const input = await fixture(t);
	const other = join(input.directory, "other");
	await mkdir(other);
	git(other, "init", "-q");
	await put(other, "foreign", "foreign content\n");
	commit(other);
	await put(input.root, "local", "local content\n");
	const collect = await collector(input, () => [], ["."], {
		...env,
		GIT_DIR: join(other, ".git"),
		GIT_COMMON_DIR: join(other, ".git"),
		GIT_WORK_TREE: other,
		GIT_INDEX_FILE: join(other, ".git/index"),
		GIT_OBJECT_DIRECTORY: join(other, ".git/objects"),
		GIT_ALTERNATE_OBJECT_DIRECTORIES: join(other, ".git/objects"),
	});
	const before = await snapshot(other);
	assert.deepEqual(await collect.collect(), [change("local", "added")]);
	assert.deepEqual(await snapshot(other), before);
});

test("does not execute external diff and text conversion programs during status", async (t) => {
	const input = await fixture(t);
	await put(input.root, ".gitattributes", "*.custom diff=fixture\n");
	await put(input.root, "file.custom", "previous content\n");
	commit(input.root);
	await put(input.root, "file.custom", "current content\n");
	// A missing executable makes accidental invocation fail without touching a
	// second source file or relying on shell-specific quoting.
	git(input.root, "config", "diff.external", join(input.directory, "missing-external-diff"));
	git(input.root, "config", "diff.fixture.textconv", join(input.directory, "missing-textconv"));
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), [change("file.custom", "modified")]);
});

test("scopes parent Git status to the workspace and hides outside rename sources", async (t) => {
	const input = await fixture(t);
	const workspace = join(input.root, "workspace");
	await mkdir(workspace);
	await put(input.root, "outside-in", "identical incoming move content\n");
	await put(workspace, "inside-out", "identical outgoing move content\n");
	await put(input.root, "outside-unreadable", "must never read outside\n");
	await put(input.root, ".gitattributes", "* -diff\n");
	commit(input.root);
	await rename(join(input.root, "outside-in"), join(workspace, "arrived"));
	await rename(join(workspace, "inside-out"), join(input.root, "departed"));
	await put(input.root, "outside-unreadable", "outside modified\n");
	git(input.root, "add", "--all");
	await chmod(join(input.root, "outside-unreadable"), 0);
	const seen: WorkspaceChange[] = [];
	const collect = await collector({ ...input, root: workspace }, (entry) => {
		seen.push(entry);
		return [];
	});
	assert.deepEqual(await collect.collect(), [change("arrived", "added"), change("inside-out", "deleted")]);
	assert.deepEqual(seen, [
		{ repo: ".", path: "arrived", kind: "added" },
		{ repo: ".", path: "inside-out", kind: "deleted" },
	]);
});

test("honors declaration order and nested ownership, skipping undeclared clones, worktrees and missing startup declarations", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	for (const path of ["main", "nested/overlap", "nested/deep/overlap", "undeclared/overlap"])
		await put(root, path, `${path} parent baseline\n`);
	commit(root);
	for (const path of ["nested", "nested/deep", "undeclared"]) {
		git(join(root, path), "init", "-q");
		await put(root, `${path}/own`, `${path} own baseline\n`);
		commit(join(root, path));
	}
	git(root, "worktree", "add", "-q", "--detach", join(root, "unlisted-worktree"));
	const seen: WorkspaceChange[] = [];
	const collect = await collector(
		input,
		(entry) => {
			seen.push(entry);
			return [];
		},
		["nested/deep", ".", "absent", "nested"],
	);
	await put(root, "main", "main current\n");
	await put(root, "nested/overlap", "nested overlap current\n");
	await put(root, "nested/own", "nested own current\n");
	await put(root, "nested/deep/overlap", "deep overlap current\n");
	await put(root, "nested/deep/own", "deep own current\n");
	await put(root, "undeclared/overlap", "undeclared current\n");
	await put(root, "unlisted-worktree/main", "worktree current\n");
	await mkdir(join(root, "absent"));
	git(join(root, "absent"), "init", "-q");
	await put(root, "absent/new", "newly appearing excluded\n");
	const before = await snapshot(root);
	assert.deepEqual(await collect.collect(), [
		change("nested/deep/overlap", "modified", { repo: "nested/deep" }),
		change("nested/deep/own", "modified", { repo: "nested/deep" }),
		change("main", "modified"),
		change("nested/overlap", "modified", { repo: "nested" }),
		change("nested/own", "modified", { repo: "nested" }),
	]);
	assert.deepEqual(
		seen.map(({ repo, path }) => ({ repo, path })),
		[
			{ repo: "nested/deep", path: "nested/deep/overlap" },
			{ repo: "nested/deep", path: "nested/deep/own" },
			{ repo: ".", path: "main" },
			{ repo: "nested", path: "nested/overlap" },
			{ repo: "nested", path: "nested/own" },
		],
	);
	assert.deepEqual(await snapshot(root), before);
});

test("omits parent gitlink dirtiness while collecting the declared child", async (t) => {
	const input = await fixture(t);
	const nested = join(input.root, "nested");
	await mkdir(nested);
	git(nested, "init", "-q");
	await put(nested, "file", "nested original\n");
	commit(nested);
	git(input.root, "update-index", "--add", "--cacheinfo", `160000,${git(nested, "rev-parse", "HEAD").trim()},nested`);
	git(input.root, "commit", "-qm", "gitlink");
	await put(nested, "file", "nested current\n");
	const collect = await collector(input, () => [], [".", "nested"]);
	assert.deepEqual(await collect.collect(), [change("nested/file", "modified", { repo: "nested" })]);
});

test("preserves an in-workspace declared repository alias without duplicating physical files", async (t) => {
	const input = await fixture(t);
	const physical = join(input.root, "physical");
	await put(input.root, "physical/file", "physical original\n");
	commit(input.root);
	git(physical, "init", "-q");
	commit(physical);
	await symlink("physical", join(input.root, "alias"));
	const seen: WorkspaceChange[] = [];
	const collect = await collector(
		input,
		(entry) => {
			seen.push(entry);
			return [];
		},
		[".", "alias"],
	);
	await put(physical, "file", "physical current\n");
	const before = await snapshot(input.root);
	assert.deepEqual(await collect.collect(), [change("alias/file", "modified", { repo: "alias" })]);
	assert.deepEqual(seen, [{ repo: "alias", path: "alias/file", kind: "modified" }]);
	assert.deepEqual(await snapshot(input.root), before);

	const outside = join(input.directory, "outside");
	await mkdir(outside);
	await rm(join(input.root, "alias"));
	await symlink(outside, join(input.root, "alias"));
	const replaced = await snapshot(input.root);
	await assert.rejects(collect.collect());
	assert.deepEqual(await snapshot(input.root), replaced);
});

test("keeps missing declared children excluded beneath an aliased repository", async (t) => {
	const input = await fixture(t);
	const physical = join(input.root, "physical");
	await put(input.root, ".gitignore", "physical/\nalias\n");
	commit(input.root);
	await mkdir(physical);
	git(physical, "init", "-q");
	await put(physical, "file", "original\n");
	commit(physical);
	await symlink("physical", join(input.root, "alias"));
	const collect = await collector(input, () => [], [".", "alias", "alias/absent"]);
	await put(physical, "file", "current\n");
	await put(physical, "absent/new-file", "appeared after startup\n");
	const before = await snapshot(input.root);
	assert.deepEqual(await collect.collect(), [change("alias/file", "modified", { repo: "alias" })]);
	assert.deepEqual(await snapshot(input.root), before);
});

test("fails when an available nested repository loses its Git identity or disappears", async (t) => {
	for (const loss of ["metadata", "directory"] as const) {
		const input = await fixture(t);
		const nested = join(input.root, "nested");
		await mkdir(nested);
		git(nested, "init", "-q");
		await put(nested, "file", "nested fixture\n");
		commit(nested);
		const collect = await collector(input, () => [], [".", "nested"]);
		await rm(loss === "metadata" ? join(nested, ".git") : nested, { recursive: true });
		const before = await snapshot(input.root);
		await assert.rejects(collect.collect());
		assert.deepEqual(await snapshot(input.root), before);
	}
});

test("isolates source split-index files and index hooks on success", async (t) => {
	for (const configuration of ["split-index", "index-hook", "both"] as const) {
		const input = await fixture(t);
		const { root } = input;
		await put(root, "tracked", "baseline content\n");
		commit(root);
		git(root, "config", "core.splitIndex", String(configuration !== "index-hook"));
		await put(root, "tracked", "staged content\n");
		git(root, "add", "tracked");
		await put(root, "tracked", "final content\n");
		if (configuration !== "split-index") {
			const hooks = join(root, ".git", "custom-hooks");
			await mkdir(hooks);
			git(root, "config", "core.hooksPath", hooks);
			const hook = join(hooks, "post-index-change");
			await writeFile(hook, '#!/bin/sh\nprintf invoked >> "$GIT_DIR/collector-hook-ran"\n');
			await chmod(hook, 0o755);
		}
		const before = await snapshot(root);
		const collect = await collector(input);
		assert.deepEqual(await collect.collect(), [change("tracked", "modified")], configuration);
		assert.deepEqual(await snapshot(root), before, configuration);
	}
});

test("keeps staged renames but reports unstaged moves as additions/deletions", async (t) => {
	const input = await fixture(t);
	await put(input.root, "staged-old", "staged rename\n");
	await put(input.root, "unstaged-old", "unstaged rename\n");
	commit(input.root);
	git(input.root, "mv", "staged-old", "staged-new");
	await rename(join(input.root, "unstaged-old"), join(input.root, "unstaged-new"));
	assert.deepEqual(await (await collector(input)).collect(), [
		change("staged-new", "renamed", { from: "staged-old" }),
		change("unstaged-new", "added"),
		change("unstaged-old", "deleted"),
	]);
});

test("preserves mode-only changes and cancels staged chmod reversals", async (t) => {
	const input = await fixture(t);
	git(input.root, "config", "core.fileMode", "true");
	await put(input.root, "mode", "mode\n");
	await put(input.root, "reversed", "reversed\n");
	commit(input.root);
	await chmod(join(input.root, "mode"), 0o755);
	await chmod(join(input.root, "reversed"), 0o755);
	git(input.root, "add", "reversed");
	await chmod(join(input.root, "reversed"), 0o644);
	assert.deepEqual(await (await collector(input)).collect(), [change("mode", "modified")]);
});

test("keeps clean CRLF and working-tree encoding normalization Git-owned without refreshing stat data", async (t) => {
	const input = await fixture(t);
	await put(input.root, ".gitattributes", "*.txt text eol=crlf\n*.utf16 text working-tree-encoding=UTF-16LE\n");
	await put(input.root, "clean.txt", "first\r\nsecond\r\n");
	await put(input.root, "clean.utf16", Buffer.from("hello\n", "utf16le"));
	commit(input.root);
	// Rewrite identical bytes to invalidate index stat data without making a content change.
	await put(input.root, "clean.txt", "first\r\nsecond\r\n");
	await put(input.root, "clean.utf16", Buffer.from("hello\n", "utf16le"));
	const before = await snapshot(input.root);
	assert.deepEqual(await (await collector(input)).collect(), []);
	assert.deepEqual(await snapshot(input.root), before);
});

test("fails usefully for unresolved conflicts rather than reporting an incomplete list", async (t) => {
	const input = await fixture(t);
	await put(input.root, "conflicted", "base\n");
	commit(input.root);
	git(input.root, "checkout", "-qb", "other");
	await put(input.root, "conflicted", "theirs\n");
	commit(input.root);
	git(input.root, "checkout", "-q", "main");
	await put(input.root, "conflicted", "ours\n");
	commit(input.root);
	assert.throws(() => git(input.root, "merge", "other"));
	const before = await snapshot(input.root);
	await assert.rejects(
		(await collector(input)).collect(),
		(error: Error) => error.cause instanceof Error && /Unresolved merge conflict: conflicted/.test(error.cause.message),
	);
	assert.deepEqual(await snapshot(input.root), before);
});

test("uses trusted normalization filters and reports required filter failures", async (t) => {
	const input = await fixture(t);
	await put(input.root, ".gitattributes", "*.filtered filter=fixture\n");
	git(input.root, "config", "filter.fixture.clean", "tr A-Z a-z");
	await put(input.root, "file.filtered", "baseline\n");
	commit(input.root);
	git(input.root, "rm", "-q", "file.filtered");
	await put(input.root, "file.filtered", "BASELINE\n");
	const before = await snapshot(input.root);
	assert.deepEqual(await (await collector(input)).collect(), []);
	assert.deepEqual(await snapshot(input.root), before);
	git(input.root, "config", "filter.fixture.clean", "false");
	git(input.root, "config", "filter.fixture.required", "true");
	await assert.rejects((await collector(input)).collect());
});

test("rejects partial/promisor repository configuration before status", async (t) => {
	for (const [key, value] of [
		["extensions.partialClone", "origin"],
		["remote.origin.promisor", "true"],
	]) {
		const input = await fixture(t);
		git(input.root, "config", key as string, value as string);
		await assert.rejects(
			(await collector(input)).collect(),
			(error: Error) => error.cause instanceof Error && /Partial\/promisor/.test(error.cause.message),
		);
	}
});

test("uses a fixed number of bulk Git commands as the tracked file count grows", async (t) => {
	for (const count of [1, 250]) {
		const input = await fixture(t);
		for (let index = 0; index < count; index++) await put(input.root, `file-${index}`, `baseline ${index}\n`);
		commit(input.root);
		for (let index = 0; index < count; index++) await put(input.root, `file-${index}`, `modified ${index}\n`);
		const gitProcess = createGitProcess(env);
		const repositories = await resolveRepositories(input.root, [{ path: "." }], gitProcess);
		const commands: string[] = [];
		const collect = createWorkingChanges({
			root: input.root,
			repositories,
			codebases: [],
			git: (cwd, args, options) => {
				commands.push(args[0] as string);
				return gitProcess(cwd, args, options);
			},
		});
		assert.equal((await collect.collect()).entries.length, count);
		assert.deepEqual(commands, ["rev-parse", "config", "ls-files", "rev-parse", "diff"]);
	}
});

test("rejects undecodable filename bytes and supports aborted collection", async (t) => {
	const input = await fixture(t);
	await writeFile(Buffer.concat([Buffer.from(`${input.root}/invalid-`), Buffer.from([0xff])]), "invalid\n");
	await assert.rejects((await collector(input)).collect());
	const controller = new AbortController();
	controller.abort(new Error("stopped"));
	await assert.rejects((await collector(input)).collect(controller.signal), /stopped/);
});

test("reconciles restored deletion and rename sources by HEAD content and mode", async (t) => {
	for (const scenario of [
		"equal",
		"different",
		"rename-back",
		"rename-recreated",
		"executable",
		"link",
		"placeholder",
		"directory",
	] as const) {
		const input = await fixture(t);
		git(input.root, "config", "core.fileMode", "true");
		if (scenario === "link" || scenario === "placeholder") await symlink("target", join(input.root, "old"));
		else await put(input.root, "old", "baseline\n");
		commit(input.root);
		if (scenario.startsWith("rename")) {
			git(input.root, "mv", "old", "new");
			if (scenario === "rename-back") await rename(join(input.root, "new"), join(input.root, "old"));
			else await put(input.root, "old", "baseline\n");
		} else {
			git(input.root, "rm", "-q", "old");
			if (scenario === "link") await symlink("target", join(input.root, "old"));
			else if (scenario === "placeholder") {
				git(input.root, "config", "core.symlinks", "false");
				await put(input.root, "old", "target");
			} else if (scenario === "directory") await put(input.root, "old/child", "new child\n");
			else await put(input.root, "old", scenario === "different" ? "different\n" : "baseline\n");
			if (scenario === "executable") await chmod(join(input.root, "old"), 0o755);
		}
		const before = await snapshot(input.root);
		const actual = await (await collector(input)).collect();
		const expected =
			scenario === "different" || scenario === "executable"
				? [change("old", "modified")]
				: scenario === "rename-recreated"
					? [change("new", "added")]
					: scenario === "directory"
						? [change("old", "deleted"), change("old/child", "added")]
						: [];
		assert.deepEqual(actual, expected, scenario);
		assert.deepEqual(await snapshot(input.root), before, scenario);
	}
});

test("rejects corrupt HEAD refs while allowing unborn staged-then-deleted additions", async (t) => {
	const input = await fixture(t);
	await put(input.root, "transient", "temporary\n");
	git(input.root, "add", "transient");
	await rm(join(input.root, "transient"));
	assert.deepEqual(await (await collector(input)).collect(), []);
	await writeFile(join(input.root, ".git/refs/heads/main"), "broken-ref\n");
	await assert.rejects((await collector(input)).collect());
	await writeFile(join(input.root, ".git/refs/heads/main"), `${"a".repeat(40)}\n`);
	await assert.rejects((await collector(input)).collect());
});

test("rejects equal conflict stages even when bulk diff would be empty and ignores outside conflicts", async (t) => {
	const input = await fixture(t);
	await put(input.root, "conflict", "same\n");
	await put(input.root, "workspace/file", "owned\n");
	commit(input.root);
	const oid = git(input.root, "rev-parse", "HEAD:conflict").trim();
	git(input.root, "update-index", "--force-remove", "conflict");
	execFileSync("git", ["-C", input.root, "update-index", "--index-info"], {
		env,
		input: [1, 2, 3].map((stage) => `100644 ${oid} ${stage}\tconflict\n`).join(""),
	});
	assert.equal(git(input.root, "diff", "--raw", "HEAD"), "");
	await assert.rejects((await collector(input)).collect());
	assert.deepEqual(await (await collector({ root: join(input.root, "workspace") })).collect(), []);
});

test("preserves a leading BOM character in untracked and restored filenames", async (t) => {
	const input = await fixture(t);
	const name = "\uFEFFname";
	await put(input.root, name, "literal filename\n");
	const collect = await collector(input);
	const untracked = await snapshot(input.root);
	assert.deepEqual(await collect.collect(), [change(name, "added")]);
	assert.deepEqual(await snapshot(input.root), untracked);
	commit(input.root);
	git(input.root, "rm", "-q", "--", name);
	await put(input.root, name, "literal filename\n");
	const restored = await snapshot(input.root);
	assert.deepEqual(await collect.collect(), []);
	assert.deepEqual(await snapshot(input.root), restored);
});

test("reconciles executable restorations using Git's owner execute bit", async (t) => {
	for (const [headMode, currentMode, changed] of [
		[0o644, 0o654, false],
		[0o644, 0o645, false],
		[0o755, 0o655, true],
		[0o755, 0o744, false],
	] as const) {
		const input = await fixture(t);
		git(input.root, "config", "core.fileMode", "true");
		await put(input.root, "file", "same content\n");
		await chmod(join(input.root, "file"), headMode);
		commit(input.root);
		git(input.root, "rm", "-q", "file");
		await put(input.root, "file", "same content\n");
		await chmod(join(input.root, "file"), currentMode);
		const before = await snapshot(input.root);
		assert.deepEqual(
			await (await collector(input)).collect(),
			changed ? [change("file", "modified")] : [],
			`${headMode.toString(8)} -> ${currentMode.toString(8)}`,
		);
		assert.deepEqual(await snapshot(input.root), before);
	}
});

test("preserves newline and trailing-space roots and tagged-looking untracked filenames", async (t) => {
	const input = await fixture(t);
	const root = join(input.directory, " root\nwith trailing space ");
	await rename(input.root, root);
	await put(root, "tracked", "baseline\n");
	commit(root);
	await put(root, "tracked", "changed\n");
	const names = [`100644 ${"a".repeat(40)} 1\tpretend\nconflict`, "M tracked", "? untracked"];
	for (const name of names) await put(root, name, "literal untracked\n");
	const collect = await collector({ root });
	const before = await snapshot(root);
	assert.deepEqual(await collect.collect(), [
		...names.toSorted().map((name) => change(name, "added")),
		change("tracked", "modified"),
	]);
	assert.deepEqual(await snapshot(root), before);
});

test("checks changed promisor configuration and pack markers on every Refresh", async (t) => {
	const input = await fixture(t);
	await put(input.root, "tracked", "baseline\n");
	commit(input.root);
	await put(input.root, "tracked", "changed\n");
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), [change("tracked", "modified")]);
	git(input.root, "config", "remote.origin.promisor", "true");
	const configured = await snapshot(input.root);
	await assert.rejects(
		collect.collect(),
		(error: Error) => error.cause instanceof Error && /Partial\/promisor/.test(error.cause.message),
	);
	assert.deepEqual(await snapshot(input.root), configured);
	git(input.root, "config", "remote.origin.promisor", "false");
	const marker = join(input.root, ".git/objects/pack/new.promisor");
	await writeFile(marker, "");
	const marked = await snapshot(input.root);
	await assert.rejects(
		collect.collect(),
		(error: Error) => error.cause instanceof Error && /Partial\/promisor/.test(error.cause.message),
	);
	assert.deepEqual(await snapshot(input.root), marked);
	await rm(marker);
	assert.deepEqual(await collect.collect(), [change("tracked", "modified")]);
});

test("rejects ignored equal conflict stages before HEAD or diff in the combined listing", async (t) => {
	const input = await fixture(t);
	await put(input.root, "tracked", "same\n");
	await put(input.root, ".gitignore", "conflict*\n");
	commit(input.root);
	const name = "conflict\nwith\ttabs";
	const oid = git(input.root, "rev-parse", "HEAD:tracked").trim();
	execFileSync("git", ["-C", input.root, "update-index", "-z", "--index-info"], {
		env,
		input: Buffer.from([1, 2, 3].map((stage) => `100644 ${oid} ${stage}\t${name}\0`).join("")),
	});
	await put(input.root, name, "ignored conflict\n");
	const gitProcess = createGitProcess(env);
	const repositories = await resolveRepositories(input.root, [{ path: "." }], gitProcess);
	const seen: string[][] = [];
	const collect = createWorkingChanges({
		root: input.root,
		repositories,
		codebases: [],
		git: (cwd, args, options) => {
			seen.push([...args]);
			return gitProcess(cwd, args, options);
		},
	});
	const before = await snapshot(input.root);
	await assert.rejects(
		collect.collect(),
		(error: Error) =>
			error.cause instanceof Error && error.cause.message.includes(`Unresolved merge conflict: ${name}`),
	);
	assert.equal(
		seen.some((args) => args[0] === "diff" || args.includes("HEAD^{commit}")),
		false,
	);
	const listing = seen.find((args) => args[0] === "ls-files");
	assert.ok(listing);
	for (const flag of ["--unmerged", "--others", "--exclude-standard", "-t", "-z"]) assert.ok(listing.includes(flag));
	assert.deepEqual(await snapshot(input.root), before);
});

test("uses two serial Git lanes and emits entries after both finish in declaration order", {
	timeout: 5000,
}, async (t) => {
	const input = await fixture(t);
	const paths = ["slow", "fast", "third"];
	for (const path of paths) {
		await mkdir(join(input.root, path));
		git(join(input.root, path), "init", "-q");
		await put(input.root, `${path}/file`, "baseline\n");
		commit(join(input.root, path));
		await put(input.root, `${path}/file`, "changed\n");
	}
	const gitProcess = createGitProcess(env);
	const repositories = await resolveRepositories(
		input.root,
		paths.map((path) => ({ path })),
		gitProcess,
	);
	let releaseFirst!: () => void;
	const firstFinished = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let releaseThird!: () => void;
	const thirdFinished = new Promise<void>((resolve) => {
		releaseThird = resolve;
	});
	t.after(() => {
		releaseFirst();
		releaseThird();
	});
	let active = 0;
	let peak = 0;
	const busy = new Set<string>();
	const finished: string[] = [];
	const before = await snapshot(input.root);
	const result = await createWorkingChanges({
		root: input.root,
		repositories,
		git: async (cwd, args, options) => {
			assert.equal(busy.has(cwd), false, "commands within each repository stay serial");
			busy.add(cwd);
			active++;
			peak = Math.max(peak, active);
			try {
				if (cwd === join(input.root, "slow")) {
					if (args[0] === "diff") await thirdFinished;
					else await firstFinished;
				}
				const result = await gitProcess(cwd, args, options);
				if (args[0] === "diff") {
					finished.push(cwd);
					if (cwd === join(input.root, "fast")) releaseFirst();
					if (cwd === join(input.root, "third")) releaseThird();
				}
				return result;
			} finally {
				active--;
				busy.delete(cwd);
			}
		},
		codebases: [],
	}).collect();
	assert.equal(peak, 2);
	assert.deepEqual(
		finished,
		["fast", "third", "slow"].map((path) => join(input.root, path)),
	);
	assert.deepEqual(
		result.entries.map((item) => item.repo),
		paths,
	);
	assert.equal(active, 0);
	assert.deepEqual(await snapshot(input.root), before);
});

async function filterPids(marker: string): Promise<number[]> {
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			return JSON.parse(await readFile(marker, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	throw new Error("Filter did not report its PIDs");
}

for (const mode of ["peer failure", "parent abort"]) {
	test(`${mode} joins cancelled filter descendants and preserves first-failure attribution`, {
		timeout: 5000,
	}, async (t) => {
		const input = await fixture(t);
		const slow = join(input.root, "slow");
		const bad = join(input.root, "bad");
		for (const root of [slow, bad]) {
			await mkdir(root);
			git(root, "init", "-q");
			await put(root, "file.txt", "baseline\n");
			commit(root);
			await put(root, "file.txt", "changed\n");
		}
		const marker = join(input.directory, "pids");
		const script = join(slow, ".git/filter.mjs");
		await writeFile(
			script,
			`
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => writeFileSync(process.env.FORGE_FILTER_PIDS, JSON.stringify([process.pid, child.pid])));
setInterval(() => {}, 1000);
`,
		);
		await put(slow, ".gitattributes", "*.txt filter=hanging\n");
		git(slow, "config", "filter.hanging.clean", `${process.execPath} ${script}`);
		git(slow, "config", "filter.hanging.required", "true");
		if (mode === "peer failure") git(bad, "config", "remote.origin.promisor", "true");
		const gitProcess = createGitProcess({ ...env, FORGE_FILTER_PIDS: marker });
		const repositories = await resolveRepositories(input.root, [{ path: "slow" }, { path: "bad" }], gitProcess);
		let active = 0;
		const controller = new AbortController();
		t.after(() => controller.abort());
		const before = await snapshot(input.root);
		await assert.rejects(
			createWorkingChanges({
				root: input.root,
				repositories,
				git: async (cwd, args, options) => {
					active++;
					try {
						if (cwd === bad && args[0] === "config") {
							await filterPids(marker);
							if (mode === "parent abort") controller.abort(new Error("external stop"));
						}
						return await gitProcess(cwd, args, options);
					} finally {
						active--;
					}
				},
				codebases: [],
			}).collect(controller.signal),
			(error: Error) => {
				if (mode === "peer failure") {
					assert.equal(error.message, "Change collection failed for repository bad");
					assert.ok(error.cause instanceof Error);
					assert.match(error.cause.message, /Partial\/promisor/);
				} else {
					const messages: string[] = [];
					for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) messages.push(cause.message);
					assert.match(messages.join(" "), /external stop|aborted/);
				}
				return true;
			},
		);
		assert.equal(active, 0, "all pending Git lanes settled before rejection");
		for (const pid of await filterPids(marker)) {
			try {
				const stat = await readFile(`/proc/${pid}/stat`, "utf8");
				assert.match(stat.slice(stat.lastIndexOf(")") + 2), /^[ZX] /, `filter process ${pid} is terminated`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		assert.deepEqual(await snapshot(input.root), before);
	});
}

test("retains side kinds, exact text counts, binary classification and rename owners in one tree", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	await put(root, "old/file", "keep one\nkeep two\nkeep three\nkeep four\nremove\n");
	await put(root, "binary", Buffer.from([0, 1]));
	await put(root, "link", "target");
	commit(root);
	await mkdir(join(root, "new"));
	git(root, "mv", "old/file", "new/file");
	await put(root, "new/file", "keep one\nkeep two\nkeep three\nkeep four\nreplacement\nextra\n");
	await put(root, "binary", Buffer.from([0, 2]));
	await rm(join(root, "link"));
	await symlink("target", join(root, "link"));
	await put(root, "empty", "");
	await put(root, "no-lf", "last line");
	const gitProcess = createGitProcess(env);
	const tree = await createWorkingChanges({
		root,
		repositories: await resolveRepositories(root, [{ path: "." }], gitProcess),
		codebases: [
			{ root: join(root, "old"), guide: join(root, "guides/old") },
			{ root: join(root, "new"), guide: join(root, "guides/new") },
		],
		git: gitProcess,
	}).collect();
	const renamed = tree.entries.find(({ path }) => path === "new/file");
	assert.equal(renamed?.kind, "renamed");
	assert.equal(renamed?.base?.codebase?.root, join(root, "old"));
	assert.equal(renamed?.current?.codebase?.root, join(root, "new"));
	assert.deepEqual(renamed?.statistics, { added: 2, removed: 1, binary: false });
	assert.deepEqual(tree.nodes.get("binary")?.statistics, { added: 0, removed: 0, binary: true });
	assert.equal(tree.nodes.get("link")?.base?.kind, "file");
	assert.equal(tree.nodes.get("link")?.current?.kind, "symlink");
	assert.deepEqual(tree.nodes.get("empty")?.statistics, { added: 0, removed: 0, binary: false });
	assert.deepEqual(tree.nodes.get("no-lf")?.statistics, { added: 1, removed: 0, binary: false });
	assert.deepEqual(tree.totals("old"), { added: 0, removed: 0 });
	assert.deepEqual(tree.totals("new"), { added: 2, removed: 1 });
	assert.deepEqual(tree.totals(), { added: 3, removed: 1 });
});

for (const scenario of ["deletion recreation", "rename recreation"] as const) {
	test(`${scenario} compares normalized final pairs once and cleans external scratch resources`, async (t) => {
		const input = await fixture(t);
		const { root } = input;
		const script = join(root, ".git/clean.mjs");
		await writeFile(
			script,
			"let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>process.stdout.write('normalized\\n'+text));\n",
		);
		git(root, "config", "filter.prefix.clean", `${process.execPath} ${script}`);
		git(root, "config", "filter.prefix.required", "true");
		await put(root, ".gitattributes", "*.txt filter=prefix\n");
		await put(root, "old.txt", "one\ntwo\nthree\n");
		commit(root);
		git(root, "config", "core.splitIndex", "true");
		git(root, "update-index", "--split-index");
		if (scenario === "deletion recreation") git(root, "rm", "-q", "old.txt");
		else git(root, "mv", "old.txt", "new.txt");
		await put(root, "old.txt", "one\nchanged\n");
		const before = await snapshot(root);
		const actual = createGitProcess(env);
		const resources = new Set<string>();
		const gitProcess: typeof actual = async (cwd, args, options) => {
			if (options?.scratchIndex) {
				assert.equal(options.scratchIndex.startsWith(`${root}/`), false);
				resources.add(dirname(options.scratchIndex));
			}
			return actual(cwd, args, options);
		};
		const tree = await createWorkingChanges({
			root,
			repositories: await resolveRepositories(root, [{ path: "." }], gitProcess),
			codebases: [],
			git: gitProcess,
		}).collect();
		assert.deepEqual(tree.nodes.get("old.txt")?.statistics, { added: 1, removed: 2, binary: false });
		if (scenario === "rename recreation") {
			assert.deepEqual(tree.nodes.get("new.txt")?.statistics, { added: 4, removed: 0, binary: false });
			assert.deepEqual(tree.totals(), { added: 5, removed: 2 });
		} else assert.deepEqual(tree.totals(), { added: 1, removed: 2 });
		assert.ok(resources.size > 0);
		for (const directory of resources) await assert.rejects(lstat(directory), { code: "ENOENT" });
		assert.deepEqual(await snapshot(root), before);
	});
}

test("Refresh observes newly added and removed undeclared repository boundaries", async (t) => {
	const input = await fixture(t);
	await put(input.root, "nested/file", "before\n");
	commit(input.root);
	await put(input.root, "nested/file", "after\n");
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), [change("nested/file", "modified")]);
	git(join(input.root, "nested"), "init", "-q");
	assert.deepEqual(await collect.collect(), []);
	await rm(join(input.root, "nested/.git"), { recursive: true });
	assert.deepEqual(await collect.collect(), [change("nested/file", "modified")]);
});

for (const failure of ["required filter", "cancellation"] as const) {
	test(`scratch reconciliation cleans external resources after ${failure} and preserves split indexes`, {
		timeout: 5000,
	}, async (t) => {
		const input = await fixture(t);
		const { root } = input;
		await put(root, "file.txt", "baseline\n");
		commit(root);
		git(root, "config", "core.splitIndex", "true");
		git(root, "update-index", "--split-index");
		git(root, "rm", "-q", "file.txt");
		await put(root, "file.txt", "recreated\n");
		const script = join(root, ".git/clean.mjs");
		const marker = join(input.directory, "pids");
		await writeFile(
			script,
			failure === "required filter"
				? "process.exit(23);\n"
				: `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => writeFileSync(process.env.FORGE_FILTER_PIDS, JSON.stringify([process.pid, child.pid])));
setInterval(() => {}, 1000);
`,
		);
		await put(root, ".gitattributes", "*.txt filter=exceptional\n");
		git(root, "config", "filter.exceptional.clean", `${process.execPath} ${script}`);
		git(root, "config", "filter.exceptional.required", "true");
		const actual = createGitProcess({ ...env, FORGE_FILTER_PIDS: marker });
		const resources = new Set<string>();
		const gitProcess: typeof actual = (cwd, args, options) => {
			if (options?.scratchIndex) resources.add(dirname(options.scratchIndex));
			return actual(cwd, args, options);
		};
		const service = createWorkingChanges({
			root,
			repositories: await resolveRepositories(root, [{ path: "." }], gitProcess),
			codebases: [],
			git: gitProcess,
		});
		const before = await snapshot(root);
		const controller = new AbortController();
		t.after(() => controller.abort());
		const pending = service.collect(controller.signal);
		const rejected = assert.rejects(pending);
		if (failure === "cancellation") {
			const pids = await filterPids(marker);
			controller.abort();
			await rejected;
			for (const pid of pids) {
				try {
					const stat = await readFile(`/proc/${pid}/stat`, "utf8");
					assert.match(stat.slice(stat.lastIndexOf(")") + 2), /^[ZX] /);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
		} else await rejected;
		assert.ok(resources.size > 0, "failed operation owned an external index");
		for (const directory of resources) await assert.rejects(lstat(directory), { code: "ENOENT" });
		assert.deepEqual(await snapshot(root), before);
	});
}
