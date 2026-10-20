import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
		assert.match(result.stdout, /listed-component-edges-only/);
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

test("HTTP libraries and component edges follow the architecture map", () => {
	const temporary = mkdtempSync(join(tmpdir(), "forge-http-graph-"));
	try {
		symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
		const files: Record<string, string> = {
			"src/components/workspace-policy/index.ts": "export type Value = string;",
			"src/components/workspace-changes/index.ts": "export type { Value } from '../workspace-policy/index.ts';",
			"src/components/workspace-api/index.ts":
				"export type { Value } from '../workspace-policy/index.ts'; export type { Value as Change } from '../workspace-changes/index.ts';",
			"src/components/workspace-api/internal/routes.ts": "import { Hono } from 'hono'; export const app = new Hono();",
			"src/lib/loopback-access/internal/guard.ts":
				"import type { MiddlewareHandler } from 'hono'; export type Guard = MiddlewareHandler;",
			"src/app/http.ts": "import { Hono } from 'hono'; export const app = new Hono();",
			"src/app/listener.ts": "import { serve } from '@hono/node-server'; export const listen = serve;",
		};
		function write(path: string, contents: string) {
			mkdirSync(dirname(join(temporary, path)), { recursive: true });
			writeFileSync(join(temporary, path), contents);
		}
		for (const [path, contents] of Object.entries(files)) write(path, contents);
		function cruise() {
			return spawnSync(
				join(root, "node_modules/.bin/depcruise"),
				["--config", join(root, ".dependency-cruiser.mjs"), "src/**/*.ts"],
				{ cwd: temporary, encoding: "utf8" },
			);
		}
		const valid = cruise();
		assert.equal(valid.status, 0, valid.stdout + valid.stderr);
		write(
			"src/components/workspace-policy/internal/invalid.ts",
			"import '../../workspace-api/index.ts'; import { Hono } from 'hono'; export const app = new Hono();",
		);
		write("src/app/invalid.ts", "import { serve } from '@hono/node-server'; export const listen = serve;");
		write("src/components/workspace-api/internal/invalid.ts", "import '../../unlisted/index.ts';");
		write("src/components/unlisted/index.ts", "export type Value = string;");
		write(
			"src/components/workspace-changes/internal/invalid.ts",
			"import '../../workspace-api/index.ts'; import '../../unlisted/index.ts';",
		);
		const invalid = cruise();
		assert.notEqual(invalid.status, 0);
		for (const rule of [
			"listed-component-edges-only",
			"workspace-api-component-edges",
			"workspace-changes-component-edges",
			"hono-confinement",
			"node-adapter-confinement",
		])
			assert.ok(invalid.stdout.includes(rule), invalid.stdout + invalid.stderr);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
