import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareFileCoverage } from "@zdreamer/forge-ts-react-frontend/structure";
import { checkUi, discoverSources, runTool, structureChecker } from "../check-ui.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function fixture(run: (directory: string, write: (path: string, contents: string) => void) => void) {
	const directory = mkdtempSync(join(tmpdir(), "forge-ui-tooling-"));
	const write = (path: string, contents: string) => {
		mkdirSync(dirname(join(directory, path)), { recursive: true });
		writeFileSync(join(directory, path), contents);
	};
	try {
		symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir");
		cpSync(join(root, ".dependency-cruiser.mjs"), join(directory, ".dependency-cruiser.mjs"));
		write(
			"tsconfig.json",
			JSON.stringify({
				compilerOptions: { paths: { "@forge/api-contract": ["./server/src/components/api-contract/index.ts"] } },
			}),
		);
		write("package.json", '{"type":"module"}');
		write("ui/src/main.tsx", 'import App from "./App"; void App;');
		write("ui/src/App.tsx", 'export default function App() { return <main {...{title: "TSX"}}>Overview</main>; }');
		write("ui/src/Tests/App.test.ts", 'import { it } from "vitest"; it("collected", () => {});');
		write("server/src/components/api-contract/index.ts", "export type Value = string;");
		write(
			"ui/tsconfig.json",
			JSON.stringify({
				extends: "@zdreamer/forge-ts-react-frontend/tsconfig",
				compilerOptions: { paths: { "@forge/api-contract": ["../server/src/components/api-contract/index.ts"] } },
				include: ["src"],
				exclude: ["src/**/Tests/**"],
			}),
		);
		write("ui/tsconfig.tests.json", JSON.stringify({ extends: "./tsconfig.json", include: ["src"], exclude: [] }));
		write("ui/vitest.config.ts", 'export default { test: { include: ["ui/src/**/Tests/**/*.test.ts"] } };');
		run(directory, write);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("UI and aggregate gates compose source checking and builds without server compilation in UI acceptance", () => {
	const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
	assert.match(scripts["check:ui"], /run check:ui:source/);
	assert.match(scripts["check:ui"], /run build:ui/);
	assert.doesNotMatch(scripts["check:ui"], /run build(?:\s|$)/);
	assert.equal(scripts["build:ui"], "vite build --config ui/vite.config.ts");
	assert.match(scripts["check:ui:source"], /tsc -p ui\/tsconfig.tools.json --noEmit/);
	assert.match(scripts.check, /run check:ui:source/);
	assert.match(scripts.check, /run build &&/);
	assert.match(scripts.check, /run test:workspace --built/);
});

test("UI configuration has its own Node-side TypeScript coverage", () => {
	fixture((directory, write) => {
		cpSync(join(root, "tsconfig.json"), join(directory, "tsconfig.json"));
		cpSync(join(root, "ui/tsconfig.tools.json"), join(directory, "ui/tsconfig.tools.json"));
		write("server/src/invalid.ts", 'const server: number = "not part of UI tooling";');
		assert.doesNotThrow(() => runTool(directory, "tsc", ["-p", "ui/tsconfig.tools.json", "--noEmit"]));
		write("ui/probe.config.ts", 'const config: number = "invalid UI config"; export default config;');
		assert.throws(() => runTool(directory, "tsc", ["-p", "ui/tsconfig.tools.json", "--noEmit"]), /TS2322/);
	});
});

test("standalone adapter checks actual TypeScript, Vitest and parsed graph collections", () => {
	fixture((directory, write) => {
		assert.deepEqual(
			checkUi(directory).filter(({ severity }) => severity === "error"),
			[],
		);
		write("ui/src/Tests/Uncollected.test.tsx", "export {};");
		assert.ok(checkUi(directory).some(({ rule, severity }) => rule.includes("coverage") && severity === "error"));
	});
});

test("empty source/test discovery and failed tools cannot pass", () => {
	fixture((directory) => {
		rmSync(join(directory, "ui/src"), { recursive: true });
		assert.deepEqual(discoverSources(directory), []);
		assert.ok(compareFileCoverage("source", [], []).length);
		assert.ok(compareFileCoverage("test", [], []).length);
		assert.throws(() => checkUi(directory));
		assert.throws(() => runTool(directory, "tsc", ["-p", "missing.json"]), /tsc failed/);
	});
});

test("published structure rejects private, cross-app, test and stale route bypasses", () => {
	fixture((directory, write) => {
		write("ui/src/Components/Secret/Secret.tsx", "export default function Secret() { return null; }");
		write("ui/src/Components/Secret/Internal/value.ts", "export const value = 1;");
		write(
			"ui/src/Lib/Bad/Bad.ts",
			[
				'import "../../Components/Secret/Internal/value";',
				'import "../../Tests/App.test";',
				'import "../../../../server/src/components/api-contract/index.ts";',
			].join("\n"),
		);
		write("ui/src/Routes/__root.tsx", "export const Route = {};");
		write("ui/src/Routes/index.tsx", "export const Route = {};");
		write("ui/src/Routes/routeTree.gen.ts", '// generated without index\nimport "./__root";');
		const errors = structureChecker(directory)
			.checkStructure()
			.filter(({ severity }) => severity === "error");
		for (const pattern of [/internal/i, /test/i, /scope|app|relative/i, /route/i])
			assert.ok(
				errors.some((finding) => pattern.test(JSON.stringify(finding))),
				JSON.stringify(errors),
			);
	});
});

test("real graph resolves exact public type alias and rejects private aliases and Node", () => {
	fixture((directory, write) => {
		write(
			"ui/src/App.tsx",
			'import type { Value } from "@forge/api-contract"; export type Public = Value; export default function App() { return <main />; }',
		);
		write("ui/src/Lib/Public/Public.ts", 'export type { Value } from "@forge/api-contract";');
		const graph = JSON.parse(
			runTool(directory, "depcruise", ["--config", ".dependency-cruiser.mjs", "--output-type", "json", "ui/src"]),
		) as {
			modules: { source: string; dependencies: { module: string; resolved: string }[] }[];
		};
		for (const source of ["ui/src/App.tsx", "ui/src/Lib/Public/Public.ts"])
			assert.ok(
				graph.modules
					.find((module) => module.source === source)
					?.dependencies.some(
						(edge) =>
							edge.module === "@forge/api-contract" && edge.resolved === "server/src/components/api-contract/index.ts",
					),
				`Real TSX/type-import/type-re-export edge missing for ${source}`,
			);
		assert.deepEqual(
			checkUi(directory).filter(({ severity }) => severity === "error"),
			[],
		);
		write("server/src/components/private/index.ts", "export type Value = string;");
		write(
			"tsconfig.json",
			JSON.stringify({
				compilerOptions: { paths: { "@forge/private": ["./server/src/components/private/index.ts"] } },
			}),
		);
		write(
			"ui/src/App.tsx",
			'import "node:fs"; import type { Value } from "@forge/private"; export type Public = Value;',
		);
		assert.throws(
			() => runTool(directory, "depcruise", ["--config", ".dependency-cruiser.mjs", "ui/src"]),
			/browser-not-to-server-internals/,
		);
	});
});

test("frontend preset is effective with the retained service Biome version", () => {
	fixture((directory, write) => {
		write(
			"ui/biome.json",
			JSON.stringify({
				root: false,
				extends: ["@zdreamer/forge-ts-react-frontend/biome"],
				files: { includes: ["src/**"] },
			}),
		);
		write("ui/src/valid.ts", "export const value = 1;\n");
		assert.doesNotThrow(() => runTool(directory, "biome", ["check", "ui/src/valid.ts"]));
		write("ui/src/invalid.ts", "export const value: any = 1;\n");
		assert.throws(
			() => runTool(directory, "biome", ["check", "--error-on-warnings", "ui/src/invalid.ts"]),
			/noExplicitAny/,
		);
	});
});
