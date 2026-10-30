import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGitProcess } from "../../../../../lib/git/index.ts";
import { resolveRepositories } from "../../../../workspace-repositories/index.ts";
import { createWorkingChanges } from "../index.ts";

const env = {
	PATH: "/usr/bin:/bin",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "f@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "f@example.invalid",
};

async function fixture(t: { after(callback: () => void | Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), "forge-context-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { env });
	git("init", "-q");
	const process = createGitProcess(env);
	const repositories = await resolveRepositories(root, [{ path: "." }], process);
	const source = createWorkingChanges({ root, repositories, codebases: [], git: process });
	return { root, git, source };
}

test("patch context defaults to three lines and all-context includes distant UTF-8 lines", async (t) => {
	const { root, git, source } = await fixture(t);
	const lines = Array.from({ length: 24 }, (_, index) => `строка ${index}`);
	await writeFile(join(root, "context.txt"), `${lines.join("\n")}\n`);
	git("add", "context.txt");
	git("commit", "-qm", "base");
	lines[0] = "изменено начало";
	lines[23] = "изменён конец";
	await writeFile(join(root, "context.txt"), `${lines.join("\n")}\n`);
	const tree = await source.collect();
	const compact = await source.fileDiff(tree, "context.txt");
	const expanded = await source.fileDiff(tree, "context.txt", undefined, "all");
	assert.equal(compact.kind, "text");
	assert.equal(expanded.kind, "text");
	if (compact.kind !== "text" || expanded.kind !== "text") return;
	assert.equal(compact.context, 3);
	assert.equal(expanded.context, "all");
	assert.match(compact.patch, /@@ -1,4 \+1,4 @@/);
	assert.doesNotMatch(compact.patch, /строка 12/);
	assert.match(expanded.patch, /@@ -1,24 \+1,24 @@/);
	assert.match(expanded.patch, / строка 12\n/);
	assert.match(expanded.patch, /\+изменён конец/);
});

test("patches preserve normalized CRLF, BOM and missing-final-newline markers", async (t) => {
	const { root, git, source } = await fixture(t);
	await writeFile(join(root, ".gitattributes"), "*.txt text eol=crlf\n");
	await writeFile(join(root, "text.txt"), "before\r\nlast\r\n");
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "text.txt"), Buffer.from("\ufeffchanged\r\nlast", "utf8"));
	const tree = await source.collect();
	const result = await source.fileDiff(tree, "text.txt");
	assert.equal(result.kind, "text");
	if (result.kind !== "text") return;
	assert.match(result.patch, /-before\n/);
	assert.match(result.patch, /\+\ufeffchanged\n/);
	assert.match(result.patch, /\\ No newline at end of file/);
	assert.doesNotMatch(result.patch, /\r/);
});

test("patches normalize working-tree encoding and effective symlink placeholders", async (t) => {
	const { root, git, source } = await fixture(t);
	await writeFile(join(root, ".gitattributes"), "encoded working-tree-encoding=UTF-16LE\n");
	await writeFile(join(root, "encoded"), Buffer.from("old\n", "utf16le"));
	await symlink("old-target", join(root, "link"));
	git("add", ".");
	git("commit", "-qm", "base");
	git("config", "core.symlinks", "false");
	await rm(join(root, "link"));
	await writeFile(join(root, "link"), "new-target");
	await writeFile(join(root, "encoded"), Buffer.from("new\n", "utf16le"));
	const tree = await source.collect();
	const encoded = await source.fileDiff(tree, "encoded");
	assert.equal(encoded.kind, "text");
	if (encoded.kind === "text") {
		assert.match(encoded.patch, /-old\n/);
		assert.match(encoded.patch, /\+new\n/);
	}
	const link = await source.fileDiff(tree, "link");
	assert.equal(link.kind, "text");
	if (link.kind === "text") {
		assert.equal(link.current.kind, "symlink");
		assert.match(link.patch, /-old-target/);
		assert.match(link.patch, /\+new-target/);
	}
});

test("patch outcomes keep invalid UTF-8 and binary changes explicit", async (t) => {
	const { root, git, source } = await fixture(t);
	await writeFile(join(root, ".gitattributes"), "forced diff\nbinary -diff\n");
	await writeFile(join(root, "forced"), Buffer.from("old\n"));
	await writeFile(join(root, "binary"), Buffer.from("old\n"));
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "forced"), Buffer.from([0xff, 0xfe]));
	await writeFile(join(root, "binary"), Buffer.from([0xff, 0xfe]));
	const tree = await source.collect();
	const forced = await source.fileDiff(tree, "forced");
	assert.equal(forced.kind, "unsupported");
	if (forced.kind === "unsupported") assert.equal(forced.reason, "encoding");
	const binary = await source.fileDiff(tree, "binary");
	assert.equal(binary.kind, "unsupported");
	if (binary.kind === "unsupported") assert.equal(binary.reason, "binary");
});

test("diff keeps the collected baseline when HEAD advances", async (t) => {
	const { root, git, source } = await fixture(t);
	await writeFile(join(root, "file"), "base\n");
	git("add", "file");
	git("commit", "-qm", "base");
	await writeFile(join(root, "file"), "committed later\n");
	const tree = await source.collect();
	git("add", "file");
	git("commit", "-qm", "advance HEAD");
	await writeFile(join(root, "file"), "working final\n");
	const result = await source.fileDiff(tree, "file");
	assert.equal(result.kind, "text");
	if (result.kind === "text") {
		assert.deepEqual(result.baseline, { kind: "commit", oid: git("rev-parse", "HEAD~1").toString().trim() });
		assert.match(result.patch, /-base\n/);
		assert.match(result.patch, /\+working final\n/);
		assert.doesNotMatch(result.patch, /committed later/);
	}
});

test("non-idempotent clean filters do not process the collected HEAD blob again", async (t) => {
	const { root, git, source } = await fixture(t);
	git("config", "filter.prefix.clean", "sed s/^/x/");
	git("config", "filter.prefix.smudge", "cat");
	git("config", "filter.prefix.required", "true");
	await writeFile(join(root, ".gitattributes"), "file filter=prefix\n");
	await writeFile(join(root, "file"), "old\n");
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "file"), "new\n");
	const tree = await source.collect();
	const result = await source.fileDiff(tree, "file");
	assert.equal(result.kind, "text");
	if (result.kind === "text") {
		assert.match(result.patch, /-xold\n/);
		assert.match(result.patch, /\+xnew\n/);
		assert.doesNotMatch(result.patch, /xxold|xxnew/);
	}
});

test("short patches survive a bounded full-context refusal and can be read again", async (t) => {
	const { root, git, source } = await fixture(t);
	const lines = Array.from({ length: 6000 }, () => `${'"雪'.repeat(200)}\n`);
	await writeFile(join(root, "large"), lines.join(""));
	git("add", ".");
	git("commit", "-qm", "base");
	lines[3000] = "changed\n";
	await writeFile(join(root, "large"), lines.join(""));
	const tree = await source.collect();
	assert.equal((await source.fileDiff(tree, "large")).kind, "text");
	const full = await source.fileDiff(tree, "large", undefined, "all");
	assert.equal(full.kind, "unsupported");
	if (full.kind === "unsupported") {
		assert.equal(full.reason, "too_large");
		assert.equal(full.limitBytes, 4 * 1024 * 1024);
	}
	assert.equal((await source.fileDiff(tree, "large")).kind, "text");
});

test("full patches preserve a lone CR payload before a missing-newline marker", async (t) => {
	const { root, git, source } = await fixture(t);
	await writeFile(join(root, "ending"), "before\r");
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "ending"), "after\r");
	const result = await source.fileDiff(await source.collect(), "ending", undefined, "all");
	assert.equal(result.kind, "text");
	if (result.kind === "text") {
		assert.match(result.patch, /-before\r\n\\ No newline at end of file\n/);
		assert.match(result.patch, /\+after\r\n\\ No newline at end of file\n/);
	}
});

test("encoding validation covers returned context while wider context can refuse", async (t) => {
	const { root, git, source } = await fixture(t);
	await writeFile(join(root, ".gitattributes"), "forced diff\n");
	const tail = Buffer.concat([Buffer.from("unchanged\n".repeat(100)), Buffer.from([0xff, 10])]);
	await writeFile(join(root, "forced"), Buffer.concat([Buffer.from("old\n"), tail]));
	git("add", ".");
	git("commit", "-qm", "base");
	await writeFile(join(root, "forced"), Buffer.concat([Buffer.from("new\n"), tail]));
	const tree = await source.collect();
	assert.equal((await source.fileDiff(tree, "forced")).kind, "text");
	const full = await source.fileDiff(tree, "forced", undefined, "all");
	assert.equal(full.kind, "unsupported");
	if (full.kind === "unsupported") assert.equal(full.reason, "encoding");
});

test("patches retain ordinary indexed attributes and the recreated collector's selected-only policy", async (t) => {
	const { root, git, source } = await fixture(t);
	git("config", "filter.prefix.clean", "printf 'prefix\\n'; cat");
	git("config", "filter.prefix.smudge", "cat");
	git("config", "filter.prefix.required", "true");
	await writeFile(join(root, ".gitattributes"), "*.txt filter=prefix\n");
	await writeFile(join(root, "ordinary.txt"), "old\n");
	await writeFile(join(root, "recreated.txt"), "old\n");
	git("add", ".");
	git("commit", "-qm", "base");
	await rm(join(root, ".gitattributes"));
	await writeFile(join(root, "ordinary.txt"), "new\n");
	git("rm", "-q", "recreated.txt");
	await writeFile(join(root, "recreated.txt"), "new\n");
	const tree = await source.collect();
	const ordinary = await source.fileDiff(tree, "ordinary.txt", undefined, "all");
	const recreated = await source.fileDiff(tree, "recreated.txt", undefined, "all");
	assert.equal(ordinary.kind, "text");
	assert.equal(recreated.kind, "text");
	if (ordinary.kind === "text" && recreated.kind === "text") {
		assert.deepEqual(ordinary.statistics, { added: 1, removed: 1, binary: false });
		assert.match(ordinary.patch, / prefix\n-old\n\+new\n/);
		assert.deepEqual(recreated.statistics, { added: 1, removed: 2, binary: false });
		assert.match(recreated.patch, /-prefix\n-old\n\+new\n/);
	}
});

test("recreated attribute symlinks retain the collector's populated reconciliation index", async (t) => {
	const { root, git, source } = await fixture(t);
	git("config", "filter.prefix.clean", "printf 'prefix\\n'; cat");
	git("config", "filter.prefix.smudge", "cat");
	git("config", "filter.prefix.required", "true");
	await writeFile(join(root, ".gitattributes"), "file filter=prefix\n");
	await writeFile(join(root, "file"), "old\n");
	git("add", ".");
	git("commit", "-qm", "base");
	git("rm", "-q", ".gitattributes", "file");
	await symlink("/outside/nonexistent", join(root, ".gitattributes"));
	await writeFile(join(root, "file"), "new\n");
	const index = await readFile(join(root, ".git/index"));
	const tree = await source.collect();
	const result = await source.fileDiff(tree, "file", undefined, "all");
	assert.equal(result.kind, "text");
	if (result.kind === "text") {
		assert.deepEqual(result.statistics, { added: 1, removed: 1, binary: false });
		assert.match(result.patch, / prefix\n-old\n\+new\n/);
	}
	assert.deepEqual(await readFile(join(root, ".git/index")), index);
	assert.equal(await readFile(join(root, "file"), "utf8"), "new\n");
});

test("resolved unborn baseline stays private while patch metadata retains its public identity", async (t) => {
	const { root, source } = await fixture(t);
	await writeFile(join(root, "file"), "first\n");
	const result = await source.fileDiff(await source.collect(), "file");
	assert.equal(result.kind, "text");
	if (result.kind === "text") {
		assert.deepEqual(result.baseline, { kind: "unborn" });
		assert.equal(result.base.present, false);
		assert.match(result.patch, /\+first\n/);
	}
});
