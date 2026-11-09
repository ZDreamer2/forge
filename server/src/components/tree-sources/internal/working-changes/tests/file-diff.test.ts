import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitProcess } from "../../../../../lib/git/index.ts";
import { resolveRepositories } from "../../../../workspace-repositories/index.ts";
import { createWorkingChanges, SourceForbiddenError } from "../index.ts";

const env = {
	PATH: "/usr/bin:/bin",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "f@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "f@example.invalid",
};
test("reconciled patches retain whole additions, renames, binary and literal bytes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "forge-diff-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { env });
	git("init", "-q");
	await writeFile(join(root, ".gitattributes"), "*.txt text eol=crlf\nbinary -diff\n");
	for (const name of ["source.txt", "pure", "mode", "binary"])
		await writeFile(join(root, name), "one\r\ntwo\r\nthree\r\n");
	git("add", ".");
	git("commit", "-qm", "base");
	await rename(join(root, "source.txt"), join(root, "destination.txt"));
	git("add", ".");
	await writeFile(join(root, "source.txt"), "recreated\r\n");
	await rename(join(root, "pure"), join(root, "moved"));
	git("add", "pure", "moved");
	await chmod(join(root, "mode"), 0o755);
	await writeFile(join(root, "binary"), "changed text\n");
	await writeFile(join(root, "literal\t\n#%?.txt"), "\ufeffhello");
	const process = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], process);
	const source = createWorkingChanges({ root, repositories, codebases: [], git: process });
	const tree = await source.discover();
	const destination = await source.fileDiff(tree, "destination.txt");
	assert.equal(destination.kind, "text");
	if (destination.kind === "text") {
		assert.match(destination.patch, /\+one\n\+two\n\+three\n/);
		assert.doesNotMatch(destination.patch, /\r/);
	}
	assert.equal((await source.fileDiff(tree, "moved")).kind, "metadata_only");
	assert.equal((await source.fileDiff(tree, "mode")).kind, "metadata_only");
	const binary = await source.fileDiff(tree, "binary");
	assert.equal(binary.kind, "unsupported");
	const literal = await source.fileDiff(tree, "literal\t\n#%?.txt");
	assert.equal(literal.kind, "text");
	if (literal.kind === "text") assert.match(literal.patch, /\+\ufeffhello\n\\ No newline/);
	await mkdir(join(root, "new-clone"));
	git("init", "-q", join(root, "new-clone"));
	await assert.rejects(source.fileDiff(tree, "new-clone/secret"), SourceForbiddenError);
	await assert.rejects(source.fileDiff(tree, ".git/config"), SourceForbiddenError);
	await mkdir(join(root, "outside"));
	await symlink("/tmp", join(root, "ancestor"));
	assert.deepEqual(await source.fileDiff(tree, "ancestor/secret"), { kind: "not_changed" });
});
test("file patches use reconciled staged reversals, recreated deletion and type transition sides", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "forge-pair-matrix-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { env });
	git("init", "-q");
	for (const name of ["reversal", "recreated", "directory", "link"]) await writeFile(join(root, name), "base\n");
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "reversal"), "staged\n");
	git("add", "reversal");
	await writeFile(join(root, "reversal"), "base\n");
	git("rm", "-q", "recreated");
	await writeFile(join(root, "recreated"), "restored\n");
	await rm(join(root, "directory"));
	await mkdir(join(root, "directory"));
	await writeFile(join(root, "directory", "child"), "child\n");
	await rm(join(root, "link"));
	await symlink("/outside/nonexistent", join(root, "link"));
	const process = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], process);
	const source = createWorkingChanges({ root, repositories, codebases: [], git: process });
	const tree = await source.discover();
	assert.equal((await source.fileDiff(tree, "reversal")).kind, "not_changed");
	const recreated = await source.fileDiff(tree, "recreated");
	assert.equal(recreated.kind, "text");
	if (recreated.kind === "text") {
		assert.equal(recreated.changeKind, "modified");
		assert.match(recreated.patch, /-base\n/);
		assert.match(recreated.patch, /\+restored\n/);
	}
	const link = await source.fileDiff(tree, "link");
	assert.equal(link.kind, "text");
	if (link.kind === "text") {
		assert.equal(link.base.kind, "file");
		assert.equal(link.current.kind, "symlink");
		assert.deepEqual(link.statistics, { added: 1, removed: 1, binary: false });
		const lines = link.patch.split("\n");
		const hunk = lines.findIndex((line) => line.startsWith("@@ "));
		assert.ok(hunk >= 0);
		let oldText = "",
			newText = "";
		let previous = "";
		for (const line of lines.slice(hunk + 1, -1)) {
			if (line.startsWith("\\ No newline")) {
				if (previous === "+" || previous === " ") newText = newText.slice(0, -1);
				if (previous === "-" || previous === " ") oldText = oldText.slice(0, -1);
				continue;
			}
			assert.ok(["+", "-", " "].includes(line[0] ?? ""));
			previous = line[0] ?? "";
			if (previous === "-" || previous === " ") oldText += `${line.slice(1)}\n`;
			if (previous === "+" || previous === " ") newText += `${line.slice(1)}\n`;
		}
		assert.equal(oldText, "base\n");
		assert.equal(newText, "/outside/nonexistent");
	}
	const directory = await source.fileDiff(tree, "directory");
	assert.equal(directory.kind, "text");
	if (directory.kind === "text") {
		assert.equal(directory.current.kind, "directory");
		assert.equal(directory.current.present, true);
	}

	assert.equal((await source.fileDiff(tree, "directory/child")).kind, "text");
	await rm(join(root, "directory"), { recursive: true });
	await assert.rejects(source.fileDiff(tree, "directory"));
	await writeFile(join(root, "directory"), "replacement");
	await assert.rejects(source.fileDiff(tree, "directory"));
	await rm(join(root, "directory"));
	await symlink("/outside/nonexistent", join(root, "directory"));
	await assert.rejects(source.fileDiff(tree, "directory"));

	await rm(join(root, "recreated"));
	await mkdir(join(root, "recreated"));
	await assert.rejects(source.fileDiff(tree, "recreated"));
});
test("parent-root rename keeps its pathspec-clipped addition comparison", async (t) => {
	const outer = await mkdtemp(join(tmpdir(), "forge-clipped-"));
	t.after(() => rm(outer, { recursive: true, force: true }));
	const root = join(outer, "workspace");
	await mkdir(root);
	const git = (...args: string[]) => execFileSync("git", ["-C", outer, ...args], { env });
	git("init", "-q");
	await writeFile(join(outer, ".gitattributes"), "*.txt text eol=crlf\n");
	await writeFile(join(outer, "outside.txt"), "one\r\ntwo\r\nthree\r\n");
	await writeFile(join(root, "anchor"), "");
	git("add", ".");
	git("commit", "-qm", "base");
	git("mv", "outside.txt", "workspace/inside.txt");
	const process = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], process);
	const source = createWorkingChanges({ root, repositories, codebases: [], git: process });
	const tree = await source.discover();
	const result = await source.fileDiff(tree, "inside.txt");
	assert.equal(result.kind, "text");
	if (result.kind === "text") {
		assert.equal(result.changeKind, "added");
		assert.equal(result.base.present, false);
		assert.match(result.patch, /\+one\n\+two\n\+three\n/);
		assert.doesNotMatch(result.patch, /outside/);
	}
});

test("discovery defers unrelated statistics and isolates selected and complete materialization failures", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "forge-selected-statistics-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { env });
	git("init", "-q");
	await writeFile(join(root, "tracked.txt"), "before\n");
	await writeFile(join(root, ".gitattributes"), "*.txt text eol=crlf\n");
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "tracked.txt"), "after\n");
	await writeFile(join(root, "selected.txt"), "one\r\ntwo\r\n");
	await writeFile(join(root, "unrelated.txt"), "unrelated\n");
	const actual = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], actual);
	const commands: string[] = [];
	let fail = true;
	let discoveryFailure = false;
	const source = createWorkingChanges({
		root,
		repositories,
		codebases: [],
		git: async (cwd, args, options) => {
			if (discoveryFailure && args[0] === "ls-files") throw new Error("discovery failed");
			if (args.includes("--no-index") && args.includes("--numstat")) {
				commands.push(args.at(-1) ?? "");
				if (fail && args.at(-1) === join(root, "unrelated.txt")) throw new Error("unrelated statistics failed");
			}
			return actual(cwd, args, options);
		},
	});
	const observation = await source.discover();
	assert.deepEqual(commands, []);
	const ordinary = await source.fileDiff(observation, "tracked.txt");
	assert.equal(ordinary.kind, "text");
	assert.deepEqual(commands, []);
	const selected = await source.fileDiff(observation, "selected.txt", undefined, "all");
	assert.equal(selected.kind, "text");
	if (selected.kind === "text") {
		assert.deepEqual(selected.statistics, { added: 2, removed: 0, binary: false });
		assert.equal(selected.context, "all");
		assert.match(selected.patch, /\+one\n\+two\n/);
		assert.doesNotMatch(selected.patch, /\r/);
	}
	assert.deepEqual(commands, [join(root, "selected.txt")]);
	await assert.rejects(source.fileDiff(observation, "unrelated.txt"), /unrelated statistics failed/);
	await assert.rejects(source.materialize(observation), /Change collection failed/);
	await assert.rejects(source.collect(), /Change collection failed/);
	assert.equal((await source.fileDiff(observation, "tracked.txt")).kind, "text");
	fail = false;
	const [tree, secondTree, file] = await Promise.all([
		source.materialize(observation),
		source.materialize(observation),
		source.fileDiff(observation, "selected.txt"),
	]);
	assert.deepEqual(tree.totals(), { added: 4, removed: 1 });
	assert.deepEqual(secondTree.totals(), tree.totals());
	assert.notEqual(tree, secondTree);
	assert.notEqual(tree.nodes.get("selected.txt"), secondTree.nodes.get("selected.txt"));
	if (file.kind !== "not_changed") assert.deepEqual(file.statistics, tree.nodes.get("selected.txt")?.statistics);
	const beforeFresh = commands.length;
	await source.fileDiff(observation, "selected.txt");
	assert.equal(commands.length, beforeFresh + 1, "selected statistics are not cached on discovery");
	await writeFile(join(root, "tracked.txt"), "before\n");
	assert.equal((await source.fileDiff(await source.discover(), "tracked.txt")).kind, "not_changed");
	discoveryFailure = true;
	await assert.rejects(source.discover(), /Change collection failed/);
});
