import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { createGitProcess, preflightRepository } from "../index.ts";

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "forge-git-process-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q", root]);
	return root;
}

test("process policy ignores ambient repository overrides and preserves explicit config isolation", async (t) => {
	const root = await fixture(t);
	const other = await fixture(t);
	const global = join(root, "global.config");
	await writeFile(global, "[forge]\n fixture = isolated\n");
	const git = createGitProcess({
		GIT_DIR: join(other, ".git"),
		GIT_WORK_TREE: other,
		GIT_INDEX_FILE: join(other, "index"),
		GIT_OBJECT_DIRECTORY: join(other, "objects"),
		GIT_ALTERNATE_OBJECT_DIRECTORIES: join(other, "alternates"),
		GIT_CONFIG_PARAMETERS: "'forge.fixture=ambient'",
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "core.worktree",
		GIT_CONFIG_VALUE_0: other,
		GIT_CONFIG_GLOBAL: global,
		GIT_CONFIG_NOSYSTEM: "1",
	});
	const result = await git(root, ["rev-parse", "--show-toplevel"]);
	assert.equal(result.code, 0);
	assert.equal(result.stdout.toString(), `${root}\n`);
	assert.equal((await git(root, ["config", "--get", "forge.fixture"])).stdout.toString(), "isolated\n");
});

test("preflight allows trusted clean/process filters without invoking them", async (t) => {
	const root = await fixture(t);
	const marker = join(root, "filter-ran");
	const git = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	execFileSync("git", ["-C", root, "config", "filter.marker.clean", `touch ${marker}`]);
	execFileSync("git", ["-C", root, "config", "filter.other.process", `touch ${marker}`]);
	await preflightRepository(git, root);
	await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("preflight rejects partial/promisor configuration before resolving object metadata", async () => {
	for (const config of [
		"extensions.partialclone\norigin\0",
		"extensions.partialclone\n\0",
		"remote.origin.promisor\ntrue\0",
		"remote.origin.promisor\0",
		"remote.origin.promisor\n\0",
	]) {
		let calls = 0;
		await assert.rejects(
			preflightRepository(async (_cwd, args) => {
				calls++;
				assert.deepEqual(args, ["config", "--null", "--list"]);
				return { code: 0, stdout: Buffer.from(config), stderr: Buffer.alloc(0) };
			}, "/unused"),
			/Partial\/promisor/,
		);
		assert.equal(calls, 1);
	}
});

test("preflight rejects active promisor pack markers through linked-worktree metadata", async (t) => {
	const root = await fixture(t);
	const git = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	execFileSync("git", [
		"-C",
		root,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-qm",
		"initial",
	]);
	const worktree = join(root, "linked worktree");
	execFileSync("git", ["-C", root, "worktree", "add", "--detach", "-q", worktree]);
	execFileSync("git", ["-C", root, "config", "remote.origin.promisor", "false"]);
	await preflightRepository(git, worktree);
	const marker = join(root, ".git", "objects", "pack", "pack-incomplete.promisor");
	await writeFile(marker, "");
	await assert.rejects(preflightRepository(git, root), /Partial\/promisor/);
	await assert.rejects(preflightRepository(git, worktree), /Partial\/promisor/);
	await rm(marker);
	await preflightRepository(git, worktree);
});

test("preflight leaves ordinary alternate object lookup to Git", async (t) => {
	const root = await fixture(t);
	const alternate = await fixture(t);
	await mkdir(join(root, ".git", "objects", "info"), { recursive: true });
	await writeFile(join(root, ".git", "objects", "info", "alternates"), `${alternate}/.git/objects\n`);
	await writeFile(join(alternate, ".git", "objects", "pack", "unused.promisor"), "");
	await preflightRepository(createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }), root);
});

test("stdin hashing is bounded and an early command error survives a closed input pipe", async (t) => {
	const root = await fixture(t);
	const git = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	const result = await git(root, ["hash-object", "-t", "tree", "--stdin"], { input: Buffer.alloc(0) });
	assert.equal(result.code, 0);
	assert.equal(result.stdout.toString(), "4b825dc642cb6eb9a060e54bf8d69288fbee4904\n");
	await assert.rejects(
		git(root, ["hash-object", "--stdin"], { input: Buffer.alloc(16 * 1024 * 1024 + 1) }),
		/input exceeded/,
	);
	const invalid = await git(root, ["not-a-command"], { input: Buffer.alloc(1024 * 1024) });
	assert.notEqual(invalid.code, 0);
	assert.match(invalid.stderr.toString(), /not a git command/);
});

test("deadline, cancellation and output limit terminate and reap a TERM-resistant real child", {
	timeout: 6000,
}, async (t) => {
	const root = await fixture(t);
	const executable = join(root, "git");
	const marker = join(root, "pid");
	await writeFile(
		executable,
		`#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nprocess.on('SIGTERM', () => {});\nwriteFileSync(process.env.FORGE_TEST_PID, String(process.pid));\nif (process.argv.includes('flood')) setInterval(() => process.stdout.write('x'.repeat(4096)), 1);\nelse setInterval(() => {}, 1000);\n`,
	);
	await chmod(executable, 0o755);
	const git = createGitProcess({ PATH: root, FORGE_TEST_PID: marker });
	for (const mode of ["deadline", "abort", "flood"]) {
		await rm(marker, { force: true });
		const controller = new AbortController();
		const pending = git(root, [mode], { timeoutMs: 500, maxOutputBytes: 1000, signal: controller.signal });
		const rejected = assert.rejects(
			pending,
			mode === "deadline" ? /timed out/ : mode === "abort" ? /aborted/ : /output exceeded/,
		);
		let pid: number | undefined;
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				pid = Number(await readFile(marker, "utf8"));
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		assert.ok(pid, "child reported its PID");
		if (mode === "abort") controller.abort();
		await rejected;
		assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	}
});

test("trusted clean filters normalize hashes and filter failures remain explicit", async (t) => {
	const root = await fixture(t);
	const script = join(root, "normalize.mjs");
	await writeFile(
		script,
		"process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('normalized\\n'));\n",
	);
	await writeFile(join(root, ".gitattributes"), "*.txt filter=normalize\n");
	await writeFile(join(root, "file.txt"), "working contents\n");
	execFileSync("git", ["-C", root, "config", "filter.normalize.clean", `${process.execPath} ${script}`]);
	execFileSync("git", ["-C", root, "config", "filter.normalize.required", "true"]);
	const git = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	await preflightRepository(git, root);
	const filtered = await git(root, ["hash-object", "--path=file.txt", "--", "file.txt"]);
	const normalized = await git(root, ["hash-object", "--no-filters", "--stdin"], {
		input: Buffer.from("normalized\n"),
	});
	assert.equal(filtered.code, 0);
	assert.deepEqual(filtered.stdout, normalized.stdout);
	await writeFile(script, "process.exit(23);\n");
	const failed = await git(root, ["hash-object", "--path=file.txt", "--", "file.txt"]);
	assert.notEqual(failed.code, 0);
	assert.match(failed.stderr.toString(), /filter.*failed|clean filter/);
});

test("cancelling a real clean filter terminates its TERM-resistant descendant before settling", {
	timeout: 5000,
}, async (t) => {
	const root = await fixture(t);
	const script = join(root, "filter.mjs");
	const marker = join(root, "filter-pids");
	await writeFile(
		script,
		`
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
descendant.stdout.once('data', () => writeFileSync(process.env.FORGE_FILTER_PIDS, JSON.stringify([process.pid, descendant.pid])));
setInterval(() => {}, 1000);
`,
	);
	await writeFile(join(root, ".gitattributes"), "*.txt filter=hanging\n");
	await writeFile(join(root, "file.txt"), "contents\n");
	execFileSync("git", ["-C", root, "config", "filter.hanging.clean", `${process.execPath} ${script}`]);
	const git = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", FORGE_FILTER_PIDS: marker });
	const controller = new AbortController();
	t.after(() => controller.abort());
	const pending = git(root, ["hash-object", "--path=file.txt", "--", "file.txt"], { signal: controller.signal });
	const rejected = assert.rejects(pending, /aborted/);
	let pids: number[] = [];
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			pids = JSON.parse(await readFile(marker, "utf8"));
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	assert.equal(pids.length, 2, "filter and descendant reported their PIDs");
	controller.abort();
	await rejected;
	for (const pid of pids) {
		try {
			// Linux can retain a dead orphan until its external subreaper collects it.
			const stat = await readFile(`/proc/${pid}/stat`, "utf8");
			assert.match(stat.slice(stat.lastIndexOf(")") + 2), /^[ZX] /, `filter process ${pid} is terminated`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
});

test("preflight reuses a supplied object path but retains fresh configuration and marker guards", async (t) => {
	const root = await fixture(t);
	const objects = join(root, ".git/objects");
	const gitProcess = createGitProcess({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
	const seen: string[][] = [];
	const git: typeof gitProcess = (cwd, args, options) => {
		seen.push([...args]);
		return gitProcess(cwd, args, options);
	};
	await preflightRepository(git, root, undefined, objects);
	assert.deepEqual(seen, [["config", "--null", "--list"]]);
	execFileSync("git", ["-C", root, "config", "remote.origin.promisor", "true"]);
	await assert.rejects(preflightRepository(git, root, undefined, objects), /Partial\/promisor/);
	execFileSync("git", ["-C", root, "config", "remote.origin.promisor", "false"]);
	const marker = join(objects, "pack/changed.promisor");
	await writeFile(marker, "");
	await assert.rejects(preflightRepository(git, root, undefined, objects), /Partial\/promisor/);
	await rm(marker);
	await preflightRepository(git, root, undefined, objects);
	assert.ok(seen.every((args) => args[0] === "config"));
});

test("preflight validates supplied and fallback object-store locations", async (t) => {
	const root = await fixture(t);
	for (const location of ["", "invalid\0path"]) {
		const git = async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
		await assert.rejects(preflightRepository(git, root, undefined, location), /invalid object-store location/);
	}
	for (const location of ["\n", "invalid\0path\n", Buffer.from([0xff, 0x0a])]) {
		const git = async (_cwd: string, args: readonly string[]) => ({
			code: 0,
			stdout: args[0] === "config" ? Buffer.alloc(0) : Buffer.from(location),
			stderr: Buffer.alloc(0),
		});
		await assert.rejects(preflightRepository(git, root));
	}
});

test("owned scratch indexes override hostile ambient indexes and clean their complete resources", async (t) => {
	const root = await fixture(t);
	const other = await fixture(t);
	await writeFile(join(root, "file"), "baseline\n");
	execFileSync("git", ["-C", root, "add", "file"]);
	const source = await readFile(join(root, ".git/index"));
	const hostile = join(other, "hostile-index");
	await writeFile(hostile, "do not read or write\n");
	const actual = createGitProcess({
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_INDEX_FILE: hostile,
	});
	const resources = new Set<string>();
	const git: typeof actual = (cwd, args, options) => {
		if (options?.scratchIndex) resources.add(options.scratchIndex);
		return actual(cwd, args, options);
	};
	const { withScratchIndex } = await import("../index.ts");
	await withScratchIndex(git, root, [], undefined, async (scratch) => {
		const result = await scratch(root, ["ls-files", "-z"]);
		assert.equal(result.code, 0);
		assert.equal(result.stdout.length, 0);
	});
	assert.equal(resources.size, 1);
	for (const index of resources) await assert.rejects(readFile(index), { code: "ENOENT" });
	assert.deepEqual(await readFile(join(root, ".git/index")), source);
	assert.equal(await readFile(hostile, "utf8"), "do not read or write\n");
});
