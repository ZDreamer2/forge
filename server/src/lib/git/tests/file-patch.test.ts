import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import {
	createFilePatch,
	createGitProcess,
	FILE_PATCH_LIMIT,
	FILE_RAW_LIMIT,
	type FilePatchInput,
	GitOutputLimitError,
	type GitProcess,
} from "../index.ts";

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "forge-direct-patch-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const run = (...args: string[]) => execFileSync("git", args, { cwd: root });
	run("init", "-q");
	run("config", "user.email", "fixture@example.com");
	run("config", "user.name", "Fixture");
	const git = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	const put = (path: string, bytes: string | Buffer) => writeFile(join(root, path), bytes);
	const commit = () => {
		run("add", ".");
		run("commit", "-qm", "fixture");
		return run("rev-parse", "HEAD").toString().trim();
	};
	return { root, run, git, put, commit };
}

async function metadata(root: string) {
	const result: Record<string, string> = {};
	for (const path of await readdir(join(root, ".git"), { recursive: true })) {
		const absolute = join(root, ".git", path);
		if ((await lstat(absolute)).isFile()) result[path] = (await readFile(absolute)).toString("hex");
	}
	return result;
}

test("direct normalized patches use the captured baseline, filter once, and expand context through Git", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	await put(".gitattributes", "file text eol=crlf filter=prefix\n");
	run("config", "filter.prefix.clean", "printf 'clean:'; cat");
	const old = Array.from({ length: 100 }, (_, i) => `line${i}\r\n`);
	await put("file", old.join(""));
	const baselineOid = commit();
	await put("file", "intermediate\n");
	commit();
	old[50] = "\ufeffchanged\r\n";
	await put("file", old.join(""));
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file",
		newPath: "file",
		oldMode: "100644",
		newMode: "100644",
	};
	const before = await metadata(root);
	const commands: string[][] = [];
	const observed: GitProcess = (cwd, args, options) => {
		commands.push([...args]);
		return git(cwd, args, options);
	};
	const partial = (await createFilePatch(observed, root, input)).toString();
	assert.match(partial, /@@ -48,7 \+48,7 @@/);
	assert.match(partial, /-line50\n\+\ufeffchanged\n/);
	assert.ok(!partial.includes("line0\n"));
	const full = (await createFilePatch(observed, root, { ...input, context: "all" })).toString();
	assert.match(full, /@@ -1,100 \+1,100 @@/);
	assert.ok(full.includes(" clean:line0\n") && full.includes(" line99\n"));
	assert.ok(!full.includes("clean:clean:") && !full.includes("\r"));
	assert.ok(!commands.some((args) => args.includes("hash-object") || args.includes("write-tree")));
	assert.deepEqual(await metadata(root), before);
});

test("whole additions match the collector's no-index clean/eol conversion; normalized additions own only an empty blob", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	await put(".gitattributes", "*.txt text eol=crlf filter=prefix\n");
	run("config", "filter.prefix.clean", "printf 'clean-line\\n'; cat");
	const baselineOid = commit();
	await put("new.txt", "raw\r\n");
	const before = await metadata(root);
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "new.txt",
		newPath: "new.txt",
		oldMode: "000000",
		newMode: "100644",
	};
	const resources = new Set<string>();
	const inputs: Buffer[] = [];
	const observed: GitProcess = (cwd, args, options) => {
		if (options?.scratchIndex) resources.add(options.scratchIndex);
		if (options?.objectDirectory) resources.add(options.objectDirectory);
		if (args.includes("hash-object")) inputs.push(options?.input ?? Buffer.alloc(0));
		return git(cwd, args, options);
	};
	const whole = await createFilePatch(observed, root, { ...input, comparison: { kind: "whole-addition" } });
	assert.match(
		whole.toString(),
		/new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/new.txt\n@@ -0,0 \+1,2 @@\n\+clean-line\n\+raw\n/,
	);
	assert.equal(inputs.length, 0);
	const normalized = await createFilePatch(observed, root, input);
	assert.deepEqual(normalized, whole);
	assert.equal(inputs.length, 1);
	assert.equal(inputs[0]?.length, 0);
	for (const resource of resources) await assert.rejects(lstat(resource), { code: "ENOENT" });
	assert.deepEqual(await metadata(root), before);
});

test("missing ancestor attributes use the staged source-index versions, with worktree precedence and explicit scratch provenance", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	for (const name of ["head", "index", "nested-head", "nested-index", "working"])
		run("config", `filter.${name}.clean`, `printf '${name}:'; cat`);
	await mkdir(join(root, "nested"));
	await put(".gitattributes", "*.txt filter=head text eol=crlf\n");
	await put("nested/.gitattributes", "*.txt filter=nested-head\n");
	await put("file.txt", "old\r\n");
	await put("nested/file.txt", "old\r\n");
	const baselineOid = commit();
	await put(".gitattributes", "*.txt filter=index text eol=crlf\n");
	await put("nested/.gitattributes", "*.txt filter=nested-index\n");
	run("add", ".gitattributes", "nested/.gitattributes");
	await rm(join(root, ".gitattributes"));
	await rm(join(root, "nested/.gitattributes"));
	await put("file.txt", "new\r\n");
	await put("nested/file.txt", "new\r\n");
	const before = await metadata(root);
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file.txt",
		newPath: "file.txt",
		oldMode: "100644",
		newMode: "100644",
	};
	assert.match((await createFilePatch(git, root, input)).toString(), /-head:old\n\+index:new\n/);
	assert.match(
		(await createFilePatch(git, root, { ...input, oldPath: "nested/file.txt", newPath: "nested/file.txt" })).toString(),
		/-nested-head:old\n\+nested-index:new\n/,
	);
	const scratch = await createFilePatch(git, root, { ...input, comparison: { kind: "scratch-index", entries: [] } });
	assert.match(scratch.toString(), /-head:old\n\+new\r\n/);
	await put("nested/.gitattributes", "*.txt filter=working\n");
	const working = await createFilePatch(git, root, {
		...input,
		oldPath: "nested/file.txt",
		newPath: "nested/file.txt",
	});
	assert.match(working.toString(), /-nested-head:old\n\+working:new\n/);
	assert.deepEqual(await metadata(root), before);
});

test("destination indexed attributes also apply to moved pairs and staged normalized additions", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	run("config", "filter.head.clean", "printf 'head:'; cat");
	run("config", "filter.destination.clean", "printf 'destination:'; cat");
	await mkdir(join(root, "target"));
	await put(".gitattributes", "*.txt filter=head\n");
	await put("target/.gitattributes", "*.txt filter=head\n");
	await put("source.txt", "old\n");
	const baselineOid = commit();
	await put("target/.gitattributes", "*.txt filter=destination\n");
	run("add", "target/.gitattributes");
	await rm(join(root, "target/.gitattributes"));
	run("mv", "source.txt", "target/moved.txt");
	await put("target/moved.txt", "new\n");
	await put("target/added.txt", "added\n");
	run("add", "target/added.txt");
	const before = await metadata(root);
	const moved = await createFilePatch(git, root, {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "source.txt",
		newPath: "target/moved.txt",
		oldMode: "100644",
		newMode: "100644",
	});
	assert.match(moved.toString(), /-head:old\n\+destination:new\n/);
	const added = await createFilePatch(git, root, {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "target/added.txt",
		newPath: "target/added.txt",
		oldMode: "000000",
		newMode: "100644",
	});
	assert.match(added.toString(), /\+destination:added\n/);
	assert.deepEqual(await metadata(root), before);
});

test("reconciled ancestor entries preserve fallback for recreated dangling attribute links", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	run("config", "filter.prefix.clean", "printf 'prefix\\n'; cat");
	run("config", "filter.working.clean", "printf 'working\\n'; cat");
	await put(".gitattributes", "file filter=prefix\n");
	await put("file", "old\n");
	const baselineOid = commit();
	const comparisonIndex = [".gitattributes", "file"].map((path) => ({
		path,
		mode: "100644",
		oid: run("rev-parse", `${baselineOid}:${path}`).toString().trim(),
	}));
	run("rm", "--cached", "-q", ".gitattributes", "file");
	await rm(join(root, ".gitattributes"));
	await symlink("/outside/nonexistent", join(root, ".gitattributes"));
	await put("file", "new\n");
	const before = await metadata(root);
	const observed: GitProcess = (cwd, args, options) => {
		assert.ok(!args.includes("ls-files"));
		return git(cwd, args, options);
	};
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file",
		newPath: "file",
		oldMode: "100644",
		newMode: "100644",
	};
	const patch = await createFilePatch(observed, root, {
		...input,
		comparison: { kind: "scratch-index", entries: comparisonIndex },
	});
	assert.match(patch.toString(), / prefix\n-old\n\+new\n/);
	const empty = await createFilePatch(observed, root, { ...input, comparison: { kind: "scratch-index", entries: [] } });
	assert.match(empty.toString(), /-prefix\n-old\n\+new\n/);
	await rm(join(root, ".gitattributes"));
	await put(".gitattributes", "file filter=working\n");
	const working = await createFilePatch(observed, root, {
		...input,
		comparison: { kind: "scratch-index", entries: comparisonIndex },
	});
	assert.match(working.toString(), /-prefix\n-old\n\+working\n\+new\n/);
	assert.deepEqual(await metadata(root), before);
});

test("selected .gitattributes keeps its baseline seed and deletion remains absent despite source-index fallback", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	run("config", "filter.prefix.clean", "printf '#clean\\n'; cat");
	await put(".gitattributes", ".gitattributes filter=prefix\nold text\n");
	const baselineOid = commit();
	await put(".gitattributes", ".gitattributes filter=prefix\nstaged text\n");
	run("add", ".gitattributes");
	await put(".gitattributes", ".gitattributes filter=prefix\nnew text\n");
	const before = await metadata(root);
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: ".gitattributes",
		newPath: ".gitattributes",
		oldMode: "100644",
		newMode: "100644",
		context: "all" as const,
	};
	const patch = await createFilePatch(git, root, input);
	assert.match(patch.toString(), / #clean\n \.gitattributes filter=prefix\n-old text\n\+new text\n/);
	assert.ok(!patch.includes("+#clean"));
	await rm(join(root, ".gitattributes"));
	const deleted = await createFilePatch(git, root, { ...input, newMode: "000000" });
	assert.match(deleted.toString(), /deleted file mode 100644\n/);
	assert.match(deleted.toString(), /-#clean\n-\.gitattributes filter=prefix\n-old text\n/);
	assert.deepEqual(await metadata(root), before);
});

test("unmerged ancestor attributes use Git's stage-two fallback without copying index resources", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	await put("file", "old\n");
	const baselineOid = commit();
	run("config", "filter.ours.clean", "printf 'ours:'; cat");
	const oid = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "file filter=ours\n" })
		.toString()
		.trim();
	execFileSync("git", ["update-index", "--index-info"], { cwd: root, input: `100644 ${oid} 2\t.gitattributes\n` });
	await put("file", "new\n");
	const before = await metadata(root);
	const patch = await createFilePatch(git, root, {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file",
		newPath: "file",
		oldMode: "100644",
		newMode: "100644",
	});
	assert.match(patch.toString(), /-old\n\+ours:new\n/);
	assert.deepEqual(await metadata(root), before);
});

test("short context pins inter-hunk merging and blank markers while full context reconstructs both sides", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	run("config", "diff.interHunkContext", "1000000");
	run("config", "diff.suppressBlankEmpty", "true");
	const lines = Array.from({ length: 100 }, (_, i) => (i % 2 ? `line${i}\n` : "\n"));
	const old = lines.join("");
	await put("file", old);
	const baselineOid = commit();
	lines[11] = "first edit\n";
	lines[81] = "second edit\n";
	const current = lines.join("");
	await put("file", current);
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file",
		newPath: "file",
		oldMode: "100644",
		newMode: "100644",
	};
	const short = (await createFilePatch(git, root, input)).toString();
	assert.equal((short.match(/^@@ /gm) ?? []).length, 2);
	assert.ok(short.includes(" \n") && !short.includes("line49"));
	assert.ok(!short.includes("\n\n"));
	const full = (await createFilePatch(git, root, { ...input, context: "all" })).toString();
	assert.equal((full.match(/^@@ /gm) ?? []).length, 1);
	const body = full
		.slice(full.indexOf("\n", full.indexOf("\n@@ ") + 1) + 1)
		.split("\n")
		.slice(0, -1);
	assert.equal(
		body
			.filter((line) => line.startsWith(" ") || line.startsWith("-"))
			.map((line) => `${line.slice(1)}\n`)
			.join(""),
		old,
	);
	assert.equal(
		body
			.filter((line) => line.startsWith(" ") || line.startsWith("+"))
			.map((line) => `${line.slice(1)}\n`)
			.join(""),
		current,
	);
});

test("a moved/recreated pair reads the old OID at its current attribute path and quotes workspace headers", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	await put(".gitattributes", "old filter=old\nnew filter=current\n");
	run("config", "filter.old.clean", "printf 'old:'; cat");
	run("config", "filter.current.clean", "printf 'current:'; cat");
	await put("old", "before\n");
	const baselineOid = commit();
	run("rm", "--cached", "-q", "old");
	await put("old", "recreated\n");
	await put("new", "after\n");
	const headerOldPath = 'workspace/old\n"é',
		headerNewPath = "workspace/new\té";
	const patch = await createFilePatch(git, root, {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "old",
		newPath: "new",
		oldMode: "100644",
		newMode: "100644",
		headerOldPath,
		headerNewPath,
	});
	assert.match(patch.toString(), /^diff --git "a\/workspace\/old\\n\\"\\303\\251" "b\/workspace\/new\\t\\303\\251"\n/);
	assert.match(patch.toString(), /-old:before\n\+current:after\n/);
	const recreated = await createFilePatch(git, root, {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "old",
		newPath: "old",
		oldMode: "100644",
		newMode: "100644",
	});
	assert.match(recreated.toString(), /-old:before\n\+old:recreated\n/);
});

test("deletions ignore recreated current bytes and file/directory transitions select only their file side", async (t) => {
	const { root, git, put, commit } = await fixture(t);
	await put("deleted", "before\n");
	await put("becomes-directory", "old file\n");
	await mkdir(join(root, "becomes-file"));
	await put("becomes-file/child", "child\n");
	const baselineOid = commit();
	await put("deleted", "recreated\n");
	await rm(join(root, "becomes-directory"));
	await mkdir(join(root, "becomes-directory"));
	await rm(join(root, "becomes-file"), { recursive: true });
	await put("becomes-file", "new file\n");
	for (const path of ["deleted", "becomes-directory"]) {
		const patch = await createFilePatch(git, root, {
			comparison: { kind: "source-index" as const },
			baselineOid,
			oldPath: path,
			newPath: path,
			oldMode: "100644",
			newMode: "000000",
		});
		assert.match(patch.toString(), /deleted file mode 100644\n--- a\//);
		assert.ok(!patch.includes("recreated"));
	}
	const addition = await createFilePatch(git, root, {
		baselineOid,
		oldPath: "becomes-file",
		newPath: "becomes-file",
		oldMode: "000000",
		newMode: "100644",
		comparison: { kind: "whole-addition" },
	});
	assert.match(addition.toString(), /\+new file\n/);
});

test("effective modes and links remain one exact content pair, including placeholder links", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	await put("file-link", "old file\n");
	await symlink("old-target", join(root, "link-file"));
	await symlink("old-target", join(root, "placeholder"));
	await put("mode", "same\n");
	const baselineOid = commit();
	await rm(join(root, "file-link"));
	await symlink("/outside/nonexistent", join(root, "file-link"));
	await rm(join(root, "link-file"));
	await put("link-file", "new regular\n");
	await rm(join(root, "placeholder"));
	await put("placeholder", "new-target");
	await chmod(join(root, "mode"), 0o755);
	run("config", "core.symlinks", "false");
	for (const [path, oldMode, newMode, expected] of [
		["file-link", "100644", "120000", "+/outside/nonexistent\n"],
		["link-file", "120000", "100644", "+new regular\n"],
		["placeholder", "120000", "120000", "+new-target\n"],
		["mode", "100644", "100755", "old mode 100644\nnew mode 100755\n"],
	]) {
		const patch = (
			await createFilePatch(git, root, {
				comparison: { kind: "source-index" },
				baselineOid,
				oldPath: path as string,
				newPath: path as string,
				oldMode: oldMode as string,
				newMode: newMode as string,
			})
		).toString();
		assert.equal((patch.match(/^diff --git /gm) ?? []).length, 1);
		assert.ok(patch.includes(expected as string));
	}
});

test("Git retains configured algorithms while fixed prefixes/context produce applicable hunks", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	run("config", "diff.algorithm", "histogram");
	run("config", "diff.context", "99");
	run("config", "diff.noprefix", "true");
	run("config", "diff.mnemonicPrefix", "true");
	run("config", "color.ui", "always");
	const old = "same\na\nsame\nb\nsame\nc\nsame\nd\nsame\ne\nsame\nf\n",
		current = "same\nf\nsame\na\nsame\nc\nsame\nb\nsame\nd\nsame\ne\n";
	await put("pair @@ literal", old);
	const baselineOid = commit();
	await put("pair @@ literal", current);
	const patch = await createFilePatch(git, root, {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "pair @@ literal",
		newPath: "pair @@ literal",
		oldMode: "100644",
		newMode: "100644",
	});
	assert.match(patch.toString(), /^diff --git a\/pair @@ literal b\/pair @@ literal\n/);
	assert.equal(patch.includes(27), false);
	await put("patch", patch);
	await put("pair @@ literal", old);
	run("apply", "patch");
	assert.equal(await readFile(join(root, "pair @@ literal"), "utf8"), current);
});

test("the final patch accepts exactly 4MiB and rejects one more byte without a 2MiB side cap", async (t) => {
	const { root, git, put, commit } = await fixture(t);
	await put("pair", "a\n");
	const baselineOid = commit();
	await put("pair", "b\n");
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "pair",
		newPath: "pair",
		oldMode: "100644",
		newMode: "100644",
	};
	const overhead = (await createFilePatch(git, root, input)).length - 4;
	await put("pair", `${"b".repeat(FILE_PATCH_LIMIT - 2 - overhead - 1)}\n`);
	assert.equal((await createFilePatch(git, root, input)).length, FILE_PATCH_LIMIT);
	await put("pair", `${"b".repeat(FILE_PATCH_LIMIT - 2 - overhead)}\n`);
	await assert.rejects(createFilePatch(git, root, input), GitOutputLimitError);
});

test("raw input and expanding output bounds clean scratch resources and preserve explicit filter failures", async (t) => {
	const { root, run, git, put, commit } = await fixture(t);
	await put("base", "before\n");
	const baselineOid = commit();
	await put("file", Buffer.alloc(FILE_RAW_LIMIT + 1, 120));
	const input = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file",
		newPath: "file",
		oldMode: "000000",
		newMode: "100644",
	};
	let calls = 0;
	const resources = new Set<string>();
	const observed: GitProcess = (cwd, args, options) => {
		calls++;
		if (options?.scratchIndex) resources.add(options.scratchIndex);
		if (options?.objectDirectory) resources.add(options.objectDirectory);
		return git(cwd, args, options);
	};
	await assert.rejects(createFilePatch(observed, root, input), GitOutputLimitError);
	assert.equal(calls, 0);
	await put("file", "input");
	await put(".gitattributes", "file filter=expand\n");
	run("config", "filter.expand.clean", "head -c 6000000 /dev/zero | tr '\\0' x");
	run("config", "filter.expand.required", "true");
	await assert.rejects(createFilePatch(observed, root, input), GitOutputLimitError);
	run("config", "filter.expand.clean", "exit 7");
	await assert.rejects(
		createFilePatch(observed, root, input),
		(error) => error instanceof Error && !(error instanceof GitOutputLimitError),
	);
	for (const resource of resources) await assert.rejects(lstat(resource), { code: "ENOENT" });
});

test("cancellation drains resistant filter descendants before removing owned index and empty object store", {
	timeout: 6000,
}, async (t) => {
	const { root, run, put, commit } = await fixture(t);
	await put("base", "before\n");
	const baselineOid = commit();
	const script = join(root, "filter.mjs"),
		marker = join(root, "pids"),
		controller = new AbortController();
	t.after(() => controller.abort());
	await put(
		"filter.mjs",
		`import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']}); child.stdout.once('data',()=>writeFileSync(process.env.FORGE_FILTER_PIDS,JSON.stringify([process.pid,child.pid])));setInterval(()=>{},1000);`,
	);
	await put(".gitattributes", "file filter=hanging\n");
	await put("file", "input");
	run("config", "filter.hanging.clean", `${process.execPath} ${script}`);
	run("config", "filter.hanging.required", "true");
	const actual = createGitProcess({
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		FORGE_FILTER_PIDS: marker,
	});
	const resources = new Set<string>();
	const git: GitProcess = (cwd, args, options) => {
		if (options?.scratchIndex) resources.add(options.scratchIndex);
		if (options?.objectDirectory) resources.add(options.objectDirectory);
		return actual(cwd, args, options);
	};
	const input: FilePatchInput = {
		comparison: { kind: "source-index" as const },
		baselineOid,
		oldPath: "file",
		newPath: "file",
		oldMode: "000000",
		newMode: "100644",
	};
	const pending = assert.rejects(createFilePatch(git, root, input, controller.signal), /aborted/);
	let pids: number[] = [];
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			pids = JSON.parse(await readFile(marker, "utf8"));
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	assert.equal(pids.length, 2);
	controller.abort();
	await pending;
	for (const pid of pids) {
		try {
			const stat = await readFile(`/proc/${pid}/stat`, "utf8");
			assert.match(stat.slice(stat.lastIndexOf(")") + 2), /^[ZX] /);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	for (const resource of resources) await assert.rejects(lstat(resource), { code: "ENOENT" });
});
