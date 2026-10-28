import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("one package owns dependencies and runtime-specific source trees", () => {
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	assert.equal(manifest.name, "@zdreamer/forge");
	assert.equal(manifest.bin.forge, "./dist/server/src/main.js");
	assert.equal(Object.hasOwn(manifest.exports, "./workspace"), false);
	assert.deepEqual(manifest.files, ["dist/"]);
	for (const tree of ["server", "ui"]) {
		assert.equal(existsSync(join(root, tree, "package.json")), false, `${tree} is a source boundary, not a package`);
	}
	const build = JSON.parse(readFileSync(join(root, "tsconfig.build.json"), "utf8"));
	assert.equal(build.compilerOptions.rootDir, ".");
	assert.equal(build.compilerOptions.outDir, "dist");
	for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
		assert.ok(Object.values(dependencies).every((version) => !String(version).startsWith("workspace:")));
	}
	assert.equal(existsSync(join(root, "protocol")), false, "The contract belongs to the server codebase");
	const contract = JSON.parse(readFileSync(join(root, "server/tsconfig.contract.json"), "utf8"));
	assert.deepEqual(contract.compilerOptions.types, []);
});

test("the server's public contract does not inherit Node globals", () => {
	const fixture = mkdtempSync(join(root, "server/src/components/api-contract/internal/ambient-fixture-"));
	try {
		writeFileSync(join(fixture, "example.ts"), "export const value = process.version + Buffer.from('test');\n");
		const result = spawnSync(join(root, "node_modules/.bin/tsc"), ["-p", "server/tsconfig.contract.json", "--noEmit"], {
			cwd: root,
			encoding: "utf8",
		});
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /Cannot find name 'process'/);
		assert.match(result.stdout, /Cannot find name 'Buffer'/);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("cross-environment boundaries reject runtime and type-only violations", () => {
	const temporary = mkdtempSync(join(tmpdir(), "forge-boundaries-"));
	function write(path: string, contents: string) {
		mkdirSync(dirname(join(temporary, path)), { recursive: true });
		writeFileSync(join(temporary, path), contents);
	}
	function cruise() {
		return spawnSync(
			join(root, "node_modules/.bin/depcruise"),
			["--config", join(root, ".dependency-cruiser.mjs"), "server/src", "ui/src"],
			{ cwd: temporary, encoding: "utf8" },
		);
	}
	try {
		write("server/src/components/api-contract/internal/types.ts", "export type Value = string;");
		write("server/src/components/api-contract/index.ts", "export type { Value } from './internal/types.ts';");
		write(
			"server/src/main.ts",
			"import type { Value } from './components/api-contract/index.ts'; export type Server = Value;",
		);
		write(
			"ui/src/App.tsx",
			"import type { Value } from '../../server/src/components/api-contract/index.ts'; export type Ui = Value;",
		);
		const valid = cruise();
		assert.equal(valid.status, 0, valid.stdout + valid.stderr);
		write("tools/build.ts", "export const tooling = true;");
		write("server/src/app/tooling.ts", "import '../../../tools/build.ts';");
		write("server/src/components/api-contract/internal/invalid.ts", "import 'node:fs'; import '../../../main.ts';");
		write(
			"ui/src/private.ts",
			"import type { Value } from '../../server/src/components/api-contract/internal/types.ts'; export type Invalid = Value;",
		);
		write("ui/src/invalid.ts", "import type { Server } from '../../server/src/main.ts'; export type Invalid = Server;");
		write("ui/src/node.ts", "import 'node:path';");
		write(
			"server/src/invalid.ts",
			"import '../../ui/src/App.tsx'; import './components/api-contract/internal/types.ts';",
		);
		const invalid = cruise();
		assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
		for (const rule of [
			"source-not-to-installation-entrypoints",
			"browser-not-to-server-internals",
			"server-not-to-ui",
			"api-contract-is-independent",
			"browser-not-to-node",
			"api-contract-public-entry-only",
		]) {
			assert.ok(invalid.stdout.includes(rule), invalid.stdout + invalid.stderr);
		}
		const serverOnly = spawnSync(
			join(root, "node_modules/.bin/depcruise"),
			["--config", join(root, "server/.dependency-cruiser.mjs"), "src"],
			{ cwd: join(temporary, "server"), encoding: "utf8" },
		);
		assert.notEqual(serverOnly.status, 0, serverOnly.stdout + serverOnly.stderr);
		assert.match(serverOnly.stdout, /api-contract-is-independent/);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("test placement rejects flat, uppercase and internal-adjacent tests", () => {
	for (const path of [
		"server/src/app/misplaced.test.ts",
		"server/src/components/workspace-tree/Tests/misplaced.test.ts",
		"server/src/components/workspace-tree/internal/misplaced.test.ts",
		"tests/misplaced.test.ts",
	]) {
		const temporary = mkdtempSync(join(tmpdir(), "forge-layout-"));
		const fixture = join(temporary, path);
		mkdirSync(dirname(fixture), { recursive: true });
		try {
			writeFileSync(fixture, "");
			const result = spawnSync(process.execPath, ["tools/check-test-layout.ts", temporary], {
				cwd: root,
				encoding: "utf8",
			});
			assert.notEqual(result.status, 0, result.stdout + result.stderr);
			assert.ok(result.stderr.includes(path), result.stderr);
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}
});

test("typechecking includes owner-local tests while production builds exclude tests and support", () => {
	const fixture = join(root, "server/src/app/tests/build-support.ts");
	try {
		writeFileSync(fixture, "export const testSupport = true;\n");
		function files(config: string) {
			const result = spawnSync(join(root, "node_modules/.bin/tsc"), ["-p", config, "--listFilesOnly"], {
				cwd: root,
				encoding: "utf8",
			});
			assert.equal(result.status, 0, result.stdout + result.stderr);
			return result.stdout;
		}
		const checked = files("server/tsconfig.json");
		assert.ok(checked.includes(fixture), checked);
		assert.match(checked, /src\/app\/tests\/cli\.test\.ts/);
		const built = files("tsconfig.build.json");
		assert.match(built, /src\/app\/config\.ts/);
		assert.doesNotMatch(built, /\/tests\//);
	} finally {
		rmSync(fixture, { force: true });
	}
});
