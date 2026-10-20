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
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { resolveRepositories, type WorkspaceChange, type WorkspacePolicy } from "../workspace-policy/index.ts";
import { createWorkspaceChanges } from "./index.ts";

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
	const temporaryRoot = join(directory, "scratch");
	await mkdir(root);
	await mkdir(temporaryRoot);
	git(root, "init", "-q", "--initial-branch=main");
	return { directory, root, temporaryRoot };
}

async function collector(
	input: { root: string; temporaryRoot: string },
	codebasesForChange: WorkspacePolicy["codebasesForChange"] = () => [],
	paths: readonly string[] = ["."],
	operationalEnv: Readonly<NodeJS.ProcessEnv> = env,
) {
	return createWorkspaceChanges({
		...input,
		repositories: await resolveRepositories(
			input.root,
			paths.map((path) => ({ path })),
		),
		codebasesForChange,
		env: operationalEnv,
	});
}

function change(
	path: string,
	kind: WorkspaceChange["kind"],
	addedLines: number | null,
	removedLines: number | null,
	extra: Record<string, unknown> = {},
) {
	return { repo: ".", path, kind, binary: addedLines === null, addedLines, removedLines, codebases: [], ...extra };
}

// Include the source object store, refs, index and working files, so writes by
// temporary comparison plumbing cannot hide behind an unchanged git status.
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

test("collects net working content independent of staging and hidden index flags without source mutation", async (t) => {
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
		change("assumed", "modified", 1, 1),
		change("deleted", "deleted", 0, 1),
		change("mixed", "modified", 2, 1),
		change("sparse", "modified", 1, 1),
		change("sparse-absent", "deleted", 0, 1),
		change("untracked", "added", 1, 0),
	]);
	assert.deepEqual(await snapshot(root), before);
	assert.deepEqual(await readdir(input.temporaryRoot), []);
	await put(root, "mixed", "mixed baseline\n");
	await rm(join(root, "untracked"));
	const next = await collect.collect();
	assert.equal(
		next.some((entry) => entry.path === "mixed" || entry.path === "untracked"),
		false,
	);
	assert.deepEqual(await readdir(input.temporaryRoot), []);
});

test("retains pure and edited renames, text zero counts, binary null counts and missing final newlines", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	const edited = Array.from({ length: 20 }, (_, index) => `edited rename original line ${index}\n`).join("");
	await put(root, "pure-text-old", "pure text rename\n");
	await put(root, "edited-old", edited);
	await put(root, "pure-binary-old", Buffer.from([0, 1, 2, 3, 255]));
	await put(root, "binary-modified", Buffer.from([0, 8, 9]));
	await put(root, "binary-deleted", Buffer.from([0, 12, 13]));
	await put(root, "no-final-newline", "previous");
	commit(root);
	await rename(join(root, "pure-text-old"), join(root, "pure-text-new"));
	await rename(join(root, "pure-binary-old"), join(root, "pure-binary-new"));
	await rename(join(root, "edited-old"), join(root, "edited-new"));
	await put(root, "edited-new", edited.replace("line 10\n", "line ten changed\n"));
	await put(root, "binary-modified", Buffer.from([0, 8, 10]));
	await put(root, "binary-added", Buffer.from([0, 99, 100]));
	await rm(join(root, "binary-deleted"));
	await put(root, "no-final-newline", "replacement\nsecond");
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), [
		change("binary-added", "added", null, null),
		change("binary-deleted", "deleted", null, null),
		change("binary-modified", "modified", null, null),
		change("edited-new", "renamed", 1, 1, { from: "edited-old" }),
		change("no-final-newline", "modified", 2, 1),
		change("pure-binary-new", "renamed", null, null, { from: "pure-binary-old" }),
		change("pure-text-new", "renamed", 0, 0, { from: "pure-text-old" }),
	]);
});

test("reports empty text additions and deletions with zero line counts", async (t) => {
	const input = await fixture(t);
	const collect = await collector(input);
	await put(input.root, "empty", "");
	assert.deepEqual(await collect.collect(), [change("empty", "added", 0, 0)]);
	commit(input.root);
	await rm(join(input.root, "empty"));
	assert.deepEqual(await collect.collect(), [change("empty", "deleted", 0, 0)]);
});

test("preserves executable-only changes, including binary blobs, and ignores staged chmod reversals", async (t) => {
	const input = await fixture(t);
	const { root } = input;
	git(root, "config", "core.fileMode", "true");
	await put(root, "text-mode", "mode unchanged content\n");
	await put(root, "binary-mode", Buffer.from([0, 3, 7, 11]));
	await put(root, "reversed-mode", "reversed mode content\n");
	await put(root, "head-executable", "head executable content\n");
	await chmod(join(root, "head-executable"), 0o755);
	commit(root);
	for (const name of ["text-mode", "binary-mode", "reversed-mode"]) await chmod(join(root, name), 0o755);
	git(root, "add", "reversed-mode");
	await chmod(join(root, "reversed-mode"), 0o644);
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), [
		change("binary-mode", "modified", null, null),
		change("text-mode", "modified", 0, 0),
	]);
	git(root, "config", "core.fileMode", "false");
	git(root, "update-index", "--chmod=-x", "head-executable");
	await chmod(join(root, "head-executable"), 0o644);
	assert.deepEqual(await collect.collect(), []);
	await put(root, "new-executable", "new executable content\n");
	await chmod(join(root, "new-executable"), 0o755);
	git(root, "add", "new-executable");
	assert.deepEqual(await collect.collect(), [change("new-executable", "added", 1, 0)]);
});

test("uses scoped Git attributes for binary metadata-only changes and forced-text statistics", async (t) => {
	const input = await fixture(t);
	git(input.root, "config", "core.fileMode", "true");
	await put(input.root, ".gitattributes", "*.opaque -diff\n*.forced diff\n");
	await put(input.root, "mode.opaque", "ordinary text classified as binary\n");
	await put(input.root, "previous.opaque", "ordinary renamed text classified as binary\n");
	await put(input.root, "content.forced", Buffer.from("previous\0content\n"));
	commit(input.root);
	await chmod(join(input.root, "mode.opaque"), 0o755);
	await rename(join(input.root, "previous.opaque"), join(input.root, "current.opaque"));
	await put(input.root, "content.forced", Buffer.from("current\0content\n"));
	const collect = await collector(input);
	assert.deepEqual(await collect.collect(), [
		change("content.forced", "modified", 1, 1),
		change("current.opaque", "renamed", null, null, { from: "previous.opaque" }),
		change("mode.opaque", "modified", null, null),
	]);
});

test("captures symlink targets without reading referents and handles file/directory/type replacements", async (t) => {
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
			{ path: "file-to-link", kind: "type_changed" },
			{ path: "link-to-file", kind: "type_changed" },
		],
	);
	assert.deepEqual(
		result.find((entry) => entry.path === "edited-link"),
		change("edited-link", "modified", 1, 1),
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
		names.toSorted().map((name) => change(name, "added", 1, 0)),
	);
	commit(input.root);
	for (const [index, name] of names.entries()) await put(input.root, name, `unique final ${index}\n`);
	assert.deepEqual(
		await collect.collect(),
		names.toSorted().map((name) => change(name, "modified", 1, 1)),
	);
});

test("routes final entries with both rename paths, accepts empty/shared memberships and strips extra fields", async (t) => {
	const input = await fixture(t);
	await put(input.root, "previous", "renamed policy content\n");
	commit(input.root);
	await rename(join(input.root, "previous"), join(input.root, "current"));
	await put(input.root, "unowned", "unowned content\n");
	const seen: WorkspaceChange[] = [];
	const collect = await collector(input, (entry) => {
		seen.push(entry);
		return entry.from
			? [
					{ id: "previous-owner", guidance: "guidance/does-not-have-to-exist", secret: true },
					{ id: "current-owner", guidance: "guidance/does-not-have-to-exist" },
				]
			: [];
	});
	assert.deepEqual(await collect.collect(), [
		change("current", "renamed", 0, 0, {
			from: "previous",
			codebases: [
				{ id: "previous-owner", guidance: "guidance/does-not-have-to-exist" },
				{ id: "current-owner", guidance: "guidance/does-not-have-to-exist" },
			],
		}),
		change("unowned", "added", 1, 0),
	]);
	assert.deepEqual(seen, [
		{ repo: ".", path: "current", kind: "renamed", from: "previous" },
		{ repo: ".", path: "unowned", kind: "added" },
	]);
});

test("rejects invalid and throwing policy results atomically and cleans scratch without changing sources", async (t) => {
	const input = await fixture(t);
	await put(input.root, "a", "first content\n");
	commit(input.root);
	await put(input.root, "a", "changed first content\n");
	git(input.root, "add", "a");
	await put(input.root, "z", "last content\n");
	const before = await snapshot(input.root);
	for (const invalid of [
		null,
		{},
		"bad",
		[null],
		[{}],
		[{ id: "", guidance: "g" }],
		[{ id: "a", guidance: "" }],
		[{ id: "a", guidance: 2 }],
	]) {
		const collect = await collector(input, (entry) =>
			entry.path === "a" ? [] : (invalid as ReturnType<WorkspacePolicy["codebasesForChange"]>),
		);
		await assert.rejects(collect.collect());
		assert.deepEqual(await readdir(input.temporaryRoot), []);
		assert.deepEqual(await snapshot(input.root), before);
	}
	const throwing = await collector(input, () => {
		throw new Error("routing failure");
	});
	await assert.rejects(throwing.collect(), /routing failure/);
	assert.deepEqual(await readdir(input.temporaryRoot), []);
	assert.deepEqual(await snapshot(input.root), before);
});

test("fails on invalid HEAD, Git execution errors and unreadable current content", async (t) => {
	const input = await fixture(t);
	await put(input.root, "tracked", "original content\n");
	commit(input.root);
	await put(input.root, "tracked", "changed content\n");
	const collect = await collector(input);
	const head = await readFile(join(input.root, ".git/refs/heads/main"));
	await writeFile(join(input.root, ".git/refs/heads/main"), `${"f".repeat(40)}\n`);
	const invalidBefore = await snapshot(input.root);
	await assert.rejects(collect.collect());
	assert.deepEqual(await snapshot(input.root), invalidBefore);
	assert.deepEqual(await readdir(input.temporaryRoot), []);
	await writeFile(join(input.root, ".git/refs/heads/main"), head);
	const missingGit = await collector(input, () => [], ["."], { ...env, PATH: input.temporaryRoot });
	await assert.rejects(missingGit.collect());
	assert.deepEqual(await readdir(input.temporaryRoot), []);
	await chmod(join(input.root, "tracked"), 0);
	try {
		await assert.rejects(collect.collect());
		assert.deepEqual(await readdir(input.temporaryRoot), []);
	} finally {
		await chmod(join(input.root, "tracked"), 0o644);
	}
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
	assert.deepEqual(await collect.collect(), [change("local", "added", 1, 0)]);
	assert.deepEqual(await snapshot(other), before);
});

test("fails explicitly for unsupported file types and undecodable filename bytes", async (t) => {
	for (const failure of ["fifo", "filename"] as const) {
		const input = await fixture(t);
		const collect = await collector(input);
		if (failure === "fifo") {
			await put(input.root, "unsupported", "tracked regular file\n");
			commit(input.root);
			await rm(join(input.root, "unsupported"));
			execFileSync("mkfifo", [join(input.root, "unsupported")]);
		} else
			await writeFile(
				Buffer.concat([Buffer.from(`${input.root}/invalid-`), Buffer.from([0xff])]),
				"invalid name content\n",
			);
		await assert.rejects(collect.collect());
		assert.deepEqual(await readdir(input.temporaryRoot), []);
	}
});

test("disables external diff and text conversion programs during comparison", async (t) => {
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
	assert.deepEqual(await collect.collect(), [change("file.custom", "modified", 1, 1)]);
});

test("scopes parent repositories above the workspace before renames and content reads", async (t) => {
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
	await chmod(join(input.root, "outside-unreadable"), 0);
	const seen: WorkspaceChange[] = [];
	const collect = await collector({ ...input, root: workspace }, (entry) => {
		seen.push(entry);
		return [];
	});
	assert.deepEqual(await collect.collect(), [change("arrived", "added", 1, 0), change("inside-out", "deleted", 0, 1)]);
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
		change("nested/deep/overlap", "modified", 1, 1, { repo: "nested/deep" }),
		change("nested/deep/own", "modified", 1, 1, { repo: "nested/deep" }),
		change("main", "modified", 1, 1),
		change("nested/overlap", "modified", 1, 1, { repo: "nested" }),
		change("nested/own", "modified", 1, 1, { repo: "nested" }),
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
	assert.deepEqual(await readdir(input.temporaryRoot), []);
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
	assert.deepEqual(await collect.collect(), [change("nested/file", "modified", 1, 1, { repo: "nested" })]);
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
	assert.deepEqual(await collect.collect(), [change("alias/file", "modified", 1, 1, { repo: "alias" })]);
	assert.deepEqual(seen, [{ repo: "alias", path: "alias/file", kind: "modified" }]);
	assert.deepEqual(await snapshot(input.root), before);
	assert.deepEqual(await readdir(input.temporaryRoot), []);
	const outside = join(input.directory, "outside");
	await mkdir(outside);
	await rm(join(input.root, "alias"));
	await symlink(outside, join(input.root, "alias"));
	const replaced = await snapshot(input.root);
	await assert.rejects(collect.collect());
	assert.deepEqual(await snapshot(input.root), replaced);
	assert.deepEqual(await readdir(input.temporaryRoot), []);
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
		assert.deepEqual(await readdir(input.temporaryRoot), []);
	}
});

test("isolates source split-index files and index hooks on success and policy failure", async (t) => {
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
		assert.deepEqual(await collect.collect(), [change("tracked", "modified", 1, 1)], configuration);
		assert.deepEqual(await snapshot(root), before, configuration);
		assert.deepEqual(await readdir(input.temporaryRoot), []);
		const failure = await collector(input, () => {
			throw new Error("late policy failure");
		});
		await assert.rejects(failure.collect(), /late policy failure/);
		assert.deepEqual(await snapshot(root), before, configuration);
		assert.deepEqual(await readdir(input.temporaryRoot), []);
	}
});
