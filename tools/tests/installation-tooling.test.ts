import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installationLintPaths } from "../lint-installation.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
const pnpm = "corepack pnpm --config.verify-deps-before-run=error run ";

test("installation and complete gates share validation and one fresh delivery acceptance", () => {
	assert.equal(scripts["check:installation"], `${pnpm}check:installation:source && ${pnpm}test:workspace`);
	assert.equal(
		scripts.check,
		`${pnpm}check:installation:source && ${pnpm}check:server && ${pnpm}check:ui:source && ${pnpm}test:workspace`,
	);
	const validation = scripts["check:installation:source"];
	assert.match(validation, /^node tools\/check-test-layout\.ts &&/);
	assert.match(validation, /tsc --noEmit/);
	assert.match(validation, /node tools\/lint-installation\.ts/);
	assert.match(validation, /depcruise --config \.dependency-cruiser\.mjs server\/src ui\/src/);
	assert.match(validation, /node --test --test-concurrency=1 tools\/tests\/\*\.test\.ts/);
	assert.doesNotMatch(validation, /run check(?::server|:ui)?(?:\s|$)|biome check \./);
	assert.equal(scripts["test:workspace"], "node tools/tests/workspace-consumer.ts");
});

test("installation lint checks new tooling and root configuration without linting component sources", () => {
	const directory = mkdtempSync(join(tmpdir(), "forge-installation-lint-"));
	try {
		symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
		cpSync(join(root, "biome.json"), join(directory, "biome.json"));
		for (const path of ["tools", "server", "ui"]) mkdirSync(join(directory, path));
		for (const path of ["server/invalid.ts", "ui/invalid.ts"]) writeFileSync(join(directory, path), "debugger;\n");
		writeFileSync(join(directory, "tools/probe.ts"), "export const value = 1;\n");
		writeFileSync(join(directory, "package.json"), '{\n\t"private": true\n}\n');
		writeFileSync(join(directory, "probe.mjs"), "export const value = 1;\n");
		writeFileSync(join(directory, ".dependency-cruiser.mjs"), "export const value = 1;\n");
		assert.deepEqual(installationLintPaths(directory), [
			"tools",
			".dependency-cruiser.mjs",
			"biome.json",
			"package.json",
			"probe.mjs",
		]);
		function lint() {
			return spawnSync(join(root, "node_modules/.bin/biome"), ["check", ...installationLintPaths(directory)], {
				cwd: directory,
				encoding: "utf8",
			});
		}
		const valid = lint();
		assert.equal(valid.status, 0, valid.stdout + valid.stderr);
		for (const path of ["tools/probe.ts", "probe.mjs", ".dependency-cruiser.mjs"]) {
			writeFileSync(join(directory, path), "debugger;\n");
			const invalid = lint();
			assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
			assert.match(invalid.stdout + invalid.stderr, /lint\/suspicious\/noDebugger/);
			writeFileSync(join(directory, path), "export const value = 1;\n");
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("installation types include new tooling without collecting component implementations", () => {
	const directory = mkdtempSync(join(tmpdir(), "forge-installation-types-"));
	try {
		symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
		cpSync(join(root, "tsconfig.json"), join(directory, "tsconfig.json"));
		writeFileSync(join(directory, "package.json"), '{"type":"module"}');
		for (const path of ["tools", "server", "ui"]) mkdirSync(join(directory, path));
		for (const path of ["server/invalid.ts", "ui/invalid.ts"])
			writeFileSync(join(directory, path), 'const value: number = "invalid";');
		writeFileSync(join(directory, "tools/probe.ts"), "export const value: number = 1;\n");
		function types() {
			return spawnSync(join(root, "node_modules/.bin/tsc"), ["--noEmit", "-p", "tsconfig.json"], {
				cwd: directory,
				encoding: "utf8",
			});
		}
		const valid = types();
		assert.equal(valid.status, 0, valid.stdout + valid.stderr);
		writeFileSync(join(directory, "tools/probe.ts"), 'export const value: number = "invalid";\n');
		const invalid = types();
		assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
		assert.match(invalid.stdout + invalid.stderr, /TS2322/);
		assert.doesNotMatch(invalid.stdout + invalid.stderr, /(?:server|ui)\/invalid/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
