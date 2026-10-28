import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadWorkspaceConfig } from "../index.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "forge-config-"));
	async function write(path: string, content: string | Uint8Array) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	await write(
		"workspace/forge-workspace.yaml",
		"codebases: [../app/docs/forge-codebase.yaml]\ncodebase_types: [../type/forge-codebase-type.yaml]\nrepositories: ['.', absent]\ndisplay_name: '  <BiCo>  '\nother: ignored\n",
	);
	await write("app/docs/forge-codebase.yaml", "root: ..\ntype: example/shared\n");
	await write("type/forge-codebase-type.yaml", "id: example/shared\n");
	return {
		root,
		write,
		config: join(root, "workspace/forge-workspace.yaml"),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

test("loads ordered concrete registry, optional type and exact display name from YAML-relative references", async () => {
	const f = await fixture();
	try {
		const value = await loadWorkspaceConfig(f.config);
		assert.equal(value.displayName, "  <BiCo>  ");
		assert.deepEqual(value.repositories, [{ path: "." }, { path: "absent" }]);
		assert.deepEqual(value.codebases, [
			{
				root: join(f.root, "app"),
				guide: join(f.root, "app/docs"),
				type: { id: "example/shared", guide: join(f.root, "type") },
			},
		]);
		assert.equal(value.codebases[0]?.type, value.codebaseTypes[0]);
		await f.write("standalone/forge-codebase.yaml", "root: .\n");
		await f.write(
			"workspace/forge-workspace.yaml",
			"codebases: [../standalone/forge-codebase.yaml, ../app/docs/forge-codebase.yaml]\ncodebase_types: [../type/forge-codebase-type.yaml]\nrepositories: []\n",
		);
		assert.deepEqual(
			(await loadWorkspaceConfig(f.config)).codebases.map((c) => c.root),
			[join(f.root, "standalone"), join(f.root, "app")],
		);
	} finally {
		await f.cleanup();
	}
});

test("skips missing markers and roots before resolving adopted types, but validates present markers", async () => {
	const f = await fixture();
	try {
		await f.write(
			"workspace/forge-workspace.yaml",
			"codebases: [../missing/forge-codebase.yaml, ../app/docs/forge-codebase.yaml]\ncodebase_types: []\nrepositories: []\n",
		);
		await f.write("app/docs/forge-codebase.yaml", "root: ../missing\ntype: unknown\n");
		assert.deepEqual((await loadWorkspaceConfig(f.config)).codebases, []);
		await f.write("app/docs/forge-codebase.yaml", "root: ..\ntype: unknown\n");
		await assert.rejects(loadWorkspaceConfig(f.config), /unknown codebase type/);
		await f.write("app/docs/forge-codebase.yaml", "root: forge-codebase.yaml\n");
		await assert.rejects(loadWorkspaceConfig(f.config), /root is not a directory/);
		await rm(join(f.root, "app/docs/forge-codebase.yaml"));
		await mkdir(join(f.root, "app/docs/forge-codebase.yaml"));
		await assert.rejects(loadWorkspaceConfig(f.config), /Invalid Forge configuration/);
	} finally {
		await f.cleanup();
	}
});

test("requires lists and valid declarations, preserving old display-name semantics", async () => {
	const f = await fixture();
	try {
		for (const data of [
			[],
			{},
			{ codebases: [], codebase_types: [] },
			{ codebases: {}, codebase_types: [], repositories: [] },
		]) {
			await f.write("workspace/forge-workspace.yaml", JSON.stringify(data));
			await assert.rejects(loadWorkspaceConfig(f.config));
		}
		for (const repositories of [
			[null],
			[1],
			["/absolute"],
			["../outside"],
			["a/../b"],
			["a//b"],
			["a\\b"],
			["a:b"],
			["a\0b"],
			[".", "."],
		]) {
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: [], codebase_types: [], repositories }),
			);
			await assert.rejects(loadWorkspaceConfig(f.config), /unique normalized/);
		}
		for (const name of ["", null, 1]) {
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: [], codebase_types: [], repositories: [], display_name: name }),
			);
			await assert.rejects(loadWorkspaceConfig(f.config), /nonempty string/);
		}
		await f.write(
			"workspace/forge-workspace.yaml",
			"codebases: []\ncodebase_types: []\nrepositories: []\ndisplay_name: ' '\n",
		);
		assert.equal((await loadWorkspaceConfig(f.config)).displayName, " ");
	} finally {
		await f.cleanup();
	}
});

test("rejects malformed YAML, duplicate keys, invalid UTF-8, roots and type identifiers", async () => {
	const f = await fixture();
	try {
		for (const content of ["[]", "root: [broken", "root: ..\nroot: .\n", Uint8Array.of(255)]) {
			await f.write("app/docs/forge-codebase.yaml", content);
			await assert.rejects(loadWorkspaceConfig(f.config), /Invalid Forge configuration/);
		}
		for (const content of [
			"root: /absolute\n",
			"type: example/shared\n",
			"root: ..\ntype: null\n",
			"root: ..\ntype: ''\n",
		]) {
			await f.write("app/docs/forge-codebase.yaml", content);
			await assert.rejects(loadWorkspaceConfig(f.config));
		}
		await f.write("app/docs/forge-codebase.yaml", "root: ..\n");
		await f.write("type/forge-codebase-type.yaml", "id: first\nid: second\n");
		await assert.rejects(loadWorkspaceConfig(f.config), /Invalid Forge configuration/);
	} finally {
		await f.cleanup();
	}
});

test("rejects canonical duplicate references, including missing tails and symlink aliases", async () => {
	const f = await fixture();
	try {
		await symlink(join(f.root, "app"), join(f.root, "alias"));
		await symlink(join(f.root, "absent"), join(f.root, "broken-alias"));
		for (const paths of [
			["../absent/forge-codebase.yaml", "../broken-alias/forge-codebase.yaml"],
			["../app/docs/forge-codebase.yaml", "../alias/docs/forge-codebase.yaml"],
			["../missing/forge-codebase.yaml", "../missing/../missing/forge-codebase.yaml"],
			["../app/missing/forge-codebase.yaml", "../alias/missing/forge-codebase.yaml"],
		]) {
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: paths, codebase_types: [], repositories: [] }),
			);
			await assert.rejects(loadWorkspaceConfig(f.config), /duplicate codebases reference/);
		}
		for (const path of ["../app/docs/wrong.yaml", join(f.root, "app/docs/forge-codebase.yaml")]) {
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: [path], codebase_types: [], repositories: [] }),
			);
			await assert.rejects(loadWorkspaceConfig(f.config), /must reference|must be relative/);
		}
	} finally {
		await f.cleanup();
	}
});

test("rejects equal lexical roots and duplicate type IDs while keeping symlink roots lexical", async () => {
	const f = await fixture();
	try {
		await f.write("second/forge-codebase-type.yaml", "id: example/shared\n");
		await f.write(
			"workspace/forge-workspace.yaml",
			"codebases: []\ncodebase_types: [../type/forge-codebase-type.yaml, ../second/forge-codebase-type.yaml]\nrepositories: []\n",
		);
		await assert.rejects(loadWorkspaceConfig(f.config), /Duplicate codebase type ID/);
		await f.write("app/forge-codebase.yaml", "root: .\n");
		await f.write("app/docs/forge-codebase.yaml", "root: ..\n");
		await f.write(
			"workspace/forge-workspace.yaml",
			"codebases: [../app/forge-codebase.yaml, ../app/docs/forge-codebase.yaml]\ncodebase_types: []\nrepositories: []\n",
		);
		await assert.rejects(loadWorkspaceConfig(f.config), /Duplicate codebase root/);
		await symlink(join(f.root, "app"), join(f.root, "alias"));
		await f.write("app/docs/forge-codebase.yaml", "root: ../../alias\n");
		const registry = await loadWorkspaceConfig(f.config);
		assert.deepEqual(
			registry.codebases.map((c) => c.root),
			[join(f.root, "app"), join(f.root, "alias")],
		);
	} finally {
		await f.cleanup();
	}
});
