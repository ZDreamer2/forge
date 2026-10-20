import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { loadConfig } from "./config.ts";

async function fixture(t: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), "forge-config-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, "selected");
	await mkdir(join(root, "docs/forge/workspace"), { recursive: true });
	await writeFile(join(root, "docs/forge/workspace/workspace.ts"), "export default {};");
	return { directory, root, cwd: directory, workspace: "selected", env: { ZD_AI_FORGE_PORT: "43210" } };
}

test("resolves selected workspace from invocation CWD, canonicalizes it and freezes configuration", async (t) => {
	const input = await fixture(t);
	await symlink(input.root, join(input.directory, "alias"), "dir");
	await writeFile(join(input.directory, ".env"), "ZD_AI_FORGE_PORT=invalid");
	await writeFile(join(input.root, ".env"), "ZD_AI_FORGE_PORT=12345");
	const config = await loadConfig({ ...input, workspace: "alias", env: {} });
	assert.deepEqual(config, {
		root: await realpath(input.root),
		policyPath: join(await realpath(input.root), "docs/forge/workspace/workspace.ts"),
		port: 12345,
	});
	assert.equal(Object.isFrozen(config), true);
});

test("selects default, relative and external absolute guidance using only process configuration", async (t) => {
	const input = await fixture(t);
	await writeFile(join(input.root, ".env"), "ZD_AI_FORGE_WORKSPACE_GUIDE=ignored\nZD_AI_FORGE_PORT=12345");
	assert.equal(
		(await loadConfig({ ...input, env: {} })).policyPath,
		join(input.root, "docs/forge/workspace/workspace.ts"),
	);
	assert.equal(
		(await loadConfig({ ...input, env: { ZD_AI_FORGE_WORKSPACE_GUIDE: "" } })).policyPath,
		join(input.root, "docs/forge/workspace/workspace.ts"),
	);
	for (const guidance of ["custom", join(input.directory, "external")]) {
		const folder = join(input.root, guidance);
		const expected = guidance.startsWith("/") ? guidance : folder;
		await mkdir(expected);
		await writeFile(join(expected, "workspace.ts"), "export default {};");
		assert.equal(
			(await loadConfig({ ...input, env: { ZD_AI_FORGE_WORKSPACE_GUIDE: guidance } })).policyPath,
			join(expected, "workspace.ts"),
		);
	}
});

test("invalid explicit guidance refuses startup without default fallback or ancestor search", async (t) => {
	const input = await fixture(t);
	await assert.rejects(loadConfig({ ...input, env: { ...input.env, ZD_AI_FORGE_WORKSPACE_GUIDE: "missing" } }));
	await mkdir(join(input.root, "child"));
	await assert.rejects(loadConfig({ ...input, workspace: "selected/child" }));
	await rm(join(input.root, "docs/forge/workspace/workspace.ts"));
	await assert.rejects(loadConfig(input));
	await mkdir(join(input.root, "docs/forge/workspace/workspace.ts"));
	await assert.rejects(loadConfig(input), /workspace.ts file/);
});

test("workspace must exist and be a directory", async (t) => {
	const input = await fixture(t);
	await assert.rejects(loadConfig({ ...input, workspace: "absent" }));
	await writeFile(join(input.directory, "file"), "content");
	await assert.rejects(loadConfig({ ...input, workspace: "file" }), /directory/);
});

test("process port takes precedence and empty process values fall back to dotenv", async (t) => {
	const input = await fixture(t);
	await writeFile(join(input.root, ".env"), "ZD_AI_FORGE_PORT=12345");
	assert.equal((await loadConfig(input)).port, 43210);
	assert.equal((await loadConfig({ ...input, env: { ZD_AI_FORGE_PORT: "" } })).port, 12345);
	await assert.rejects(loadConfig({ ...input, env: { ZD_AI_FORGE_PORT: "invalid" } }), /ZD_AI_FORGE_PORT/);
	await writeFile(join(input.root, ".env"), "ZD_AI_FORGE_PORT=");
	await assert.rejects(loadConfig({ ...input, env: {} }), /ZD_AI_FORGE_PORT/);
	await rm(join(input.root, ".env"));
	assert.equal((await loadConfig(input)).port, 43210);
	await assert.rejects(loadConfig({ ...input, env: {} }), /ZD_AI_FORGE_PORT/);
});

test("port accepts only up to five ASCII decimal digits in the configured range", async (t) => {
	const input = await fixture(t);
	for (const value of ["1024", "65535", "01024"]) {
		assert.equal((await loadConfig({ ...input, env: { ZD_AI_FORGE_PORT: value } })).port, Number(value));
	}
	for (const value of [
		"0",
		"1023",
		"65536",
		"001024",
		" 1024",
		"1024 ",
		"+1024",
		"1e4",
		"1.024",
		"١٠٢٤",
		"１０２４",
		"1024\n",
	]) {
		await assert.rejects(loadConfig({ ...input, env: { ZD_AI_FORGE_PORT: value } }), /ZD_AI_FORGE_PORT/);
	}
});

test("dotenv supports narrow quoting/export/whitespace syntax and last assignment wins", async (t) => {
	const input = await fixture(t);
	await writeFile(
		join(input.root, ".env"),
		"# whole line comment\nmalformed\n=ignored\nZD_AI_FORGE_PORT=invalid\n  export ZD_AI_FORGE_PORT = '12345' \nUNRELATED=secret\n",
	);
	assert.equal((await loadConfig({ ...input, env: {} })).port, 12345);
	await writeFile(join(input.root, ".env"), 'export ZD_AI_FORGE_PORT="23456"\n');
	assert.equal((await loadConfig({ ...input, env: {} })).port, 23456);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal dotenv interpolation must remain unexpanded.
	for (const value of ["12345 # inline", '"12345', "${PORT}", "123\\45", '"123\n45"']) {
		await writeFile(join(input.root, ".env"), `ZD_AI_FORGE_PORT=${value}`);
		await assert.rejects(loadConfig({ ...input, env: {} }), /ZD_AI_FORGE_PORT/);
	}
});

test("existing unreadable and invalid UTF-8 dotenv files fail even with a process port, without exposing content", async (t) => {
	const input = await fixture(t);
	await mkdir(join(input.root, ".env"));
	await assert.rejects(loadConfig(input), { message: "Cannot read the workspace .env file as UTF-8" });
	await rm(join(input.root, ".env"), { recursive: true });
	await writeFile(join(input.root, ".env"), Buffer.from([0xff, 0xfe]));
	await assert.rejects(loadConfig(input), { message: "Cannot read the workspace .env file as UTF-8" });
});
