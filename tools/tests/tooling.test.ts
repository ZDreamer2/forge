import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverRoot = join(root, "server");

test("standalone server acceptance rejects lint violations", () => {
	const fixture = mkdtempSync(join(serverRoot, "src/app/server-lint-fixture-"));
	try {
		writeFileSync(join(fixture, "example.ts"), "debugger;\n");
		const result = spawnSync("corepack", ["pnpm", "--config.verify-deps-before-run=error", "run", "check:server"], {
			cwd: root,
			encoding: "utf8",
			timeout: 30_000,
		});
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /lint\/suspicious\/noDebugger/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("inherited environment rule fires and app allowance remains effective", () => {
	const componentFixture = mkdtempSync(join(serverRoot, "src/components/tooling-fixture-"));
	const appFixture = mkdtempSync(join(serverRoot, "src/app/tooling-fixture-"));
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
			["--config", join(serverRoot, ".dependency-cruiser.mjs"), "src/**/*.ts"],
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

test("real graph preserves public browser contract type re-exports", () => {
	const result = spawnSync(
		join(root, "node_modules/.bin/depcruise"),
		["--config", ".dependency-cruiser.mjs", "--output-type", "json", "src/**/*.ts"],
		{ cwd: serverRoot, encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const graph = JSON.parse(result.stdout);
	const surface = graph.modules.find(
		(item: { source: string }) => item.source === "src/components/api-contract/index.ts",
	);
	assert.ok(surface);
	assert.deepEqual(
		surface.dependencies.map((item: { resolved: string }) => item.resolved),
		["src/components/api-contract/internal/types.ts"],
	);
	assert.equal(
		graph.modules.some((item: { source: string }) => item.source === "src/workspace.ts"),
		false,
	);
});

test("HTTP libraries and component edges follow the architecture map", () => {
	const temporary = mkdtempSync(join(tmpdir(), "forge-http-graph-"));
	try {
		symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
		const files: Record<string, string> = {
			"src/components/workspace-config/index.ts":
				"import { parse } from 'yaml'; export const value = parse('{}'); export type Value = string;",
			"src/components/tree-sources/index.ts": "export type { Value } from '../workspace-config/index.ts';",
			"src/components/http-api/internal/routes.ts": "import { Hono } from 'hono'; export const app = new Hono();",
			"src/components/diagnostic-ui/internal/routes.ts": "import { Hono } from 'hono'; export const app = new Hono();",
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
				["--config", join(serverRoot, ".dependency-cruiser.mjs"), "src/**/*.ts"],
				{ cwd: temporary, encoding: "utf8" },
			);
		}
		const valid = cruise();
		assert.equal(valid.status, 0, valid.stdout + valid.stderr);
		assert.doesNotMatch(valid.stdout, /could not resolve/);
		write(
			"src/components/workspace-config/internal/invalid.ts",
			"import '../../diagnostic-ui/internal/routes.ts'; import { Hono } from 'hono'; export const app = new Hono();",
		);
		write(
			"src/app/invalid.ts",
			"import { serve } from '@hono/node-server'; import { parse } from 'yaml'; export const value = parse('{}'); export const listen = serve;",
		);
		write("src/components/unlisted/index.ts", "export type Value = string;");
		write(
			"src/components/tree-sources/internal/invalid.ts",
			"import '../../diagnostic-ui/internal/routes.ts'; import '../../unlisted/index.ts';",
		);
		write("src/components/diagnostic-ui/internal/invalid.ts", "import '../../workspace-config/index.ts';");
		const invalid = cruise();
		assert.notEqual(invalid.status, 0);
		for (const rule of [
			"listed-component-edges-only",
			"tree-sources-component-edges",
			"hono-confinement",
			"node-adapter-confinement",
			"yaml-confinement",
		])
			assert.ok(invalid.stdout.includes(rule), invalid.stdout + invalid.stderr);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("owner-local tests can read their internals while foreign and nested internals stay private", () => {
	const temporary = mkdtempSync(join(tmpdir(), "forge-test-graph-"));
	function write(path: string, contents: string) {
		mkdirSync(dirname(join(temporary, path)), { recursive: true });
		writeFileSync(join(temporary, path), contents);
	}
	function cruise() {
		return spawnSync(
			join(root, "node_modules/.bin/depcruise"),
			["--config", join(serverRoot, ".dependency-cruiser.mjs"), "src/**/*.ts"],
			{ cwd: temporary, encoding: "utf8" },
		);
	}
	try {
		write("src/lib/a/internal/value.ts", "export const value = 1;");
		write("src/lib/a/internal/nested/internal/value.ts", "export const value = 1;");
		write("src/lib/a/internal/nested/index.ts", "export { value } from './internal/value.ts';");
		write("src/lib/a/tests/support.ts", "export const fixture = 1;");
		write("src/lib/a/tests/a.test.ts", "import '../internal/value.ts'; import '../internal/nested/index.ts';");
		write("src/lib/a/internal/nested/tests/nested.test.ts", "import '../internal/value.ts'; import '../../value.ts';");
		write("src/lib/a/internal/nested/internal/deep/internal/value.ts", "export const value = 1;");
		write(
			"src/lib/a/internal/nested/internal/deep/tests/deep.test.ts",
			"import '../internal/value.ts'; import '../../value.ts'; import '../../../../value.ts';",
		);
		const valid = cruise();
		assert.equal(valid.status, 0, valid.stdout + valid.stderr);
		assert.doesNotMatch(valid.stdout, /could not resolve/);
		write("src/lib/b/internal/value.ts", "export const value = 1;");
		write("src/lib/a/internal/sibling/internal/value.ts", "export const value = 1;");
		write("src/lib/a/internal/nested/tests/invalid.test.ts", "import '../../sibling/internal/value.ts';");
		write(
			"src/lib/a/internal/nested/internal/deep/tests/invalid.test.ts",
			"import '../../../../sibling/internal/value.ts';",
		);
		write(
			"src/lib/a/tests/invalid.test.ts",
			"import '../../b/internal/value.ts'; import '../internal/nested/internal/value.ts';",
		);
		write("src/lib/a/internal/invalid.ts", "import '../tests/support.ts';");
		const invalid = cruise();
		assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
		assert.match(invalid.stdout, /deep\/tests\/invalid\.test\.ts.*sibling\/internal\/value\.ts/);
		for (const rule of [
			"not-to-foreign-internal",
			"not-to-nested-internal",
			"tests-respect-unit-boundary:src/lib/a/internal/sibling/internal",
			"production-not-to-tests",
		]) {
			assert.ok(invalid.stdout.includes(rule), invalid.stdout + invalid.stderr);
		}
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("analysis graph allows composition edges and rejects source, reverse and contract dependencies", () => {
	const temporary = mkdtempSync(join(tmpdir(), "forge-analysis-graph-"));
	function write(path: string, text: string) {
		mkdirSync(dirname(join(temporary, path)), { recursive: true });
		writeFileSync(join(temporary, path), text);
	}
	function cruise() {
		return spawnSync(
			join(root, "node_modules/.bin/depcruise"),
			["--config", join(serverRoot, ".dependency-cruiser.mjs"), "src/**/*.ts"],
			{ cwd: temporary, encoding: "utf8" },
		);
	}
	try {
		for (const name of ["workspace-tree", "workspace-config", "tree-sources", "api-contract"])
			write(`src/components/${name}/index.ts`, "export type Fact = string;");
		write(
			"src/components/tree-analysis/index.ts",
			"import type { Fact } from '../workspace-tree/index.ts'; import '../workspace-config/index.ts'; export type Value = Fact;",
		);
		write(
			"src/components/http-api/index.ts",
			"import type { Value } from '../tree-analysis/index.ts'; export type Result = Value;",
		);
		const allowed = cruise();
		assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
		write(
			"src/components/tree-analysis/internal/invalid.ts",
			"import '../../tree-sources/index.ts'; import '../../api-contract/index.ts';",
		);
		write("src/components/workspace-tree/internal/invalid.ts", "import '../../tree-analysis/index.ts';");
		write("src/components/api-contract/internal/invalid.ts", "import '../../tree-analysis/index.ts';");
		const invalid = cruise();
		assert.notEqual(invalid.status, 0);
		for (const rule of [
			"tree-analysis-component-edges",
			"workspace-tree-component-edges",
			"api-contract-is-independent",
		])
			assert.ok(invalid.stdout.includes(rule), invalid.stdout);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
