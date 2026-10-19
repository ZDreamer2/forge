import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("inherited environment rule fires and app allowance remains effective", () => {
	const componentFixture = mkdtempSync(join(root, "src/components/tooling-fixture-"));
	const appFixture = mkdtempSync(join(root, "src/app/tooling-fixture-"));
	try {
		for (const directory of [componentFixture, appFixture]) {
			writeFileSync(join(directory, "example.ts"), "export const value = process.env.PORT;\n");
		}
		const result = spawnSync(
			join(root, "node_modules/.bin/biome"),
			["lint", "--reporter=json", componentFixture, appFixture],
			{
				cwd: root,
				encoding: "utf8",
			},
		);
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		const report = JSON.parse(result.stdout);
		const diagnostics = report.diagnostics.filter(
			(item: { category: string }) => item.category === "lint/style/noProcessEnv",
		);
		assert.equal(diagnostics.length, 1, result.stdout);
		assert.match(JSON.stringify(diagnostics), /components\/tooling-fixture-/);
	} finally {
		rmSync(componentFixture, { recursive: true, force: true });
		rmSync(appFixture, { recursive: true, force: true });
	}
});

test("inherited zone and local component restrictions reject actual imports", () => {
	const temporary = mkdtempSync(join(tmpdir(), "forge-graph-"));
	try {
		for (const directory of ["src/app", "src/components/a", "src/components/b"]) {
			mkdirSync(join(temporary, directory), { recursive: true });
		}
		writeFileSync(join(temporary, "src/app/example.ts"), "export const value = 1;\n");
		writeFileSync(join(temporary, "src/components/b/index.ts"), "export const value = 1;\n");
		writeFileSync(
			join(temporary, "src/components/a/index.ts"),
			"import '../../app/example.ts';\nimport '../b/index.ts';\n",
		);
		const result = spawnSync(
			join(root, "node_modules/.bin/depcruise"),
			["--config", join(root, ".dependency-cruiser.mjs"), "src/**/*.ts"],
			{
				cwd: temporary,
				encoding: "utf8",
			},
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stdout, /no-component-edges/);
		assert.match(result.stdout, /app/);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("real graph preserves the public type re-export", () => {
	const result = spawnSync(
		join(root, "node_modules/.bin/depcruise"),
		["--config", ".dependency-cruiser.mjs", "--output-type", "json", "src/**/*.ts"],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr);
	const graph = JSON.parse(result.stdout);
	const facade = graph.modules.find((module: { source: string }) => module.source === "src/workspace.ts");
	assert.ok(
		facade.dependencies.some(
			(dependency: { resolved: string }) => dependency.resolved === "src/components/workspace-policy/index.ts",
		),
	);
});
