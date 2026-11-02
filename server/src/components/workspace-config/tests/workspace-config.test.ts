import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadWorkspaceConfig, rootedCodebases } from "../index.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "forge-config-"));
	async function write(path: string, content: string | Uint8Array) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	await write(
		"workspace/forge-workspace.yaml",
		"codebases: [../app/docs/forge-codebase.yaml, ../type/forge-codebase.yaml]\nrepositories: ['.', absent]\ndisplay_name: '  <BiCo>  '\nother: ignored\n",
	);
	await write("app/docs/forge-codebase.yaml", "id: app\nroot: ..\nparents: [shared]\n");
	await write("type/forge-codebase.yaml", "id: shared\n");
	return {
		root,
		write,
		config: join(root, "workspace/forge-workspace.yaml"),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

test("loads ordered rooted and rootless guides, preserving display names", async () => {
	const f = await fixture();
	try {
		const value = await loadWorkspaceConfig(f.config);
		assert.equal(value.displayName, "  <BiCo>  ");
		assert.deepEqual(value.repositories, [{ path: "." }, { path: "absent" }]);
		assert.deepEqual(
			value.guides.map((g) => [g.id, g.root, g.parents]),
			[
				["app", join(f.root, "app"), ["shared"]],
				["shared", undefined, []],
			],
		);
		assert.equal(rootedCodebases(value).length, 1);
		assert.equal(value.workspace.guide, join(f.root, "workspace"));
	} finally {
		await f.cleanup();
	}
});

test("records optional missing markers and roots after validating all present declaration fields", async () => {
	const f = await fixture();
	try {
		await f.write(
			"workspace/forge-workspace.yaml",
			"codebases: [../missing/forge-codebase.yaml, ../app/docs/forge-codebase.yaml]\nrepositories: []\n",
		);
		await f.write("app/docs/forge-codebase.yaml", "id: app\nroot: ../missing\nparents: [unknown]\n");
		const result = await loadWorkspaceConfig(f.config);
		assert.deepEqual(result.guides, []);
		assert.deepEqual(
			result.unavailable.map((g) => g.id),
			[undefined, "app"],
		);
		assert.match(result.unavailable[1]?.reason ?? "", /root is missing/);
		for (const declaration of [
			"root: ../missing",
			"id: app\nroot: ../missing\nparents: null",
			"id: app\nroot: ../missing\nanalysis_handlers: null",
			"id: app\nroot: ../missing\ntype: old",
		]) {
			await f.write("app/docs/forge-codebase.yaml", declaration);
			await assert.rejects(loadWorkspaceConfig(f.config));
		}
		await f.write("app/docs/forge-codebase.yaml", "id: app\nroot: forge-codebase.yaml\n");
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
		for (const data of [[], {}, { codebases: [], codebase_types: [] }, { codebases: {}, repositories: [] }]) {
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
			await f.write("workspace/forge-workspace.yaml", JSON.stringify({ codebases: [], repositories }));
			await assert.rejects(loadWorkspaceConfig(f.config), /unique normalized/);
		}
		for (const name of ["", null, 1]) {
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: [], repositories: [], display_name: name }),
			);
			await assert.rejects(loadWorkspaceConfig(f.config), /nonempty string/);
		}
		await f.write("workspace/forge-workspace.yaml", "codebases: []\nrepositories: []\ndisplay_name: ' '\n");
		assert.equal((await loadWorkspaceConfig(f.config)).displayName, " ");
	} finally {
		await f.cleanup();
	}
});

test("rejects malformed YAML, invalid identities, roots, parents and actionable legacy vocabulary", async () => {
	const f = await fixture();
	try {
		for (const content of ["[]", "id: [broken", "id: first\nid: second", Uint8Array.of(255)]) {
			await f.write("app/docs/forge-codebase.yaml", content);
			await assert.rejects(loadWorkspaceConfig(f.config), /Invalid Forge configuration/);
		}
		for (const content of [
			"id: ''",
			"id: 5",
			'id: "x\\0y"',
			"id: app\nroot: /absolute",
			"id: app\nroot: null",
			"id: app\nparents: shared",
			"id: app\nparents: [a,a]",
			"id: app\nparents: ['']",
		]) {
			await f.write("app/docs/forge-codebase.yaml", content);
			await assert.rejects(loadWorkspaceConfig(f.config));
		}
		for (const content of [
			"codebases: []\ncodebase_types: []",
			"codebases: [../missing/forge-codebase-type.yaml]",
			"codebases: []\ntype: old",
		]) {
			await f.write("workspace/forge-workspace.yaml", content);
			await assert.rejects(loadWorkspaceConfig(f.config), /legacy.*migrate.*forge-codebase.yaml/);
		}
		for (const parents of [null, {}, ["a", "a"], [false]]) {
			await f.write("workspace/forge-workspace.yaml", JSON.stringify({ codebases: [], repositories: [], parents }));
			await assert.rejects(loadWorkspaceConfig(f.config));
		}
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
			await f.write("workspace/forge-workspace.yaml", JSON.stringify({ codebases: paths, repositories: [] }));
			await assert.rejects(loadWorkspaceConfig(f.config), /duplicate codebases reference/);
		}
		for (const path of ["../app/docs/wrong.yaml", join(f.root, "app/docs/forge-codebase.yaml")]) {
			await f.write("workspace/forge-workspace.yaml", JSON.stringify({ codebases: [path], repositories: [] }));
			await assert.rejects(loadWorkspaceConfig(f.config), /must reference|must be relative/);
		}
	} finally {
		await f.cleanup();
	}
});

test("rejects available ID/root conflicts and keeps symlink source roots lexical", async () => {
	const f = await fixture();
	try {
		await f.write("type/forge-codebase.yaml", "id: app");
		await assert.rejects(loadWorkspaceConfig(f.config), /Duplicate codebase ID/);
		await f.write("type/forge-codebase.yaml", "id: app\nroot: missing");
		assert.equal((await loadWorkspaceConfig(f.config)).guides.length, 1);
		await f.write("type/forge-codebase.yaml", "id: shared\nroot: ../app");
		await assert.rejects(loadWorkspaceConfig(f.config), /Duplicate codebase root/);
		await symlink(join(f.root, "app"), join(f.root, "alias"));
		await f.write("type/forge-codebase.yaml", "id: shared\nroot: ../alias");
		const value = await loadWorkspaceConfig(f.config);
		assert.deepEqual(
			rootedCodebases(value).map((g) => g.root),
			[join(f.root, "app"), join(f.root, "alias")],
		);
	} finally {
		await f.cleanup();
	}
});

test("rejects retired handler declarations, including empty lists, at workspace and codebase guides", async () => {
	const f = await fixture();
	try {
		for (const value of [
			[],
			null,
			{},
			"./rule.ts",
			[""],
			[1],
			["/absolute.ts"],
			["pkg"],
			["./*.ts"],
			["./rule.cjs"],
			["./nul\0.ts"],
		]) {
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: [], repositories: [], analysis_handlers: value }),
			);
			await assert.rejects(
				loadWorkspaceConfig(f.config),
				/analysis_handlers.*fixed entry forge-extension\/forge-extension\.ts/,
			);
			await f.write(
				"workspace/forge-workspace.yaml",
				JSON.stringify({ codebases: ["../app/docs/forge-codebase.yaml"], repositories: [] }),
			);
			await f.write(
				"app/docs/forge-codebase.yaml",
				JSON.stringify({ id: "app", root: "..", analysis_handlers: value }),
			);
			await assert.rejects(
				loadWorkspaceConfig(f.config),
				/analysis_handlers.*fixed entry forge-extension\/forge-extension\.ts/,
			);
		}
	} finally {
		await f.cleanup();
	}
});
