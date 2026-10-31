import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	compareFileCoverage,
	compareImportGraph,
	createStructureChecker,
	type Finding,
} from "@zdreamer/forge-ts-react-frontend/structure";

const installation = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function structureChecker(root: string) {
	return createStructureChecker({
		root,
		scopes: [{ root: "ui/src", level: "app", entry: "main.tsx" }],
		testOnlyImports: ["@zdreamer/forge-ts-react-frontend/testing", "@zdreamer/forge-ts-react-frontend/testing/http"],
	});
}

export function discoverSources(root: string): string[] {
	return globSync("ui/src/**/*", { cwd: root }).filter((path) => /\.[cm]?tsx?$/.test(path));
}

export function runTool(root: string, name: string, args: string[]): string {
	const result = spawnSync(resolve(installation, "node_modules/.bin", name), args, {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 20 * 1024 * 1024,
		timeout: 60_000,
	});
	if (result.error || result.status !== 0)
		throw new Error(`${name} failed (${result.status}): ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}

type Graph = {
	modules: { source: string; dependencies: { module: string; resolved: string; couldNotResolve?: boolean }[] }[];
};
const canonicalSpecifier = (specifier: string) => (isBuiltin(specifier) ? specifier.replace(/^node:/, "") : specifier);

export function checkUi(root: string): Finding[] {
	const checker = structureChecker(root);
	const findings = checker.checkStructure();
	const discovered = discoverSources(root);
	const checked = new Set<string>();
	for (const config of ["ui/tsconfig.json", "ui/tsconfig.tests.json"])
		for (const file of runTool(root, "tsc", ["-p", config, "--listFilesOnly"]).trim().split(/\r?\n/))
			if (file.startsWith(`${root}/ui/src/`)) checked.add(relative(root, file));
	findings.push(...compareFileCoverage("source", discovered, [...checked]));
	const tests = discovered.filter((path) => /\.(test|spec)\.[cm]?tsx?$/.test(path));
	const collected = JSON.parse(
		runTool(root, "vitest", ["list", "--config", "ui/vitest.config.ts", "--filesOnly", "--json"]),
	) as { file: string }[];
	findings.push(
		...compareFileCoverage(
			"test",
			tests,
			collected.map(({ file }) => relative(root, file)),
		),
	);
	const graph = JSON.parse(
		runTool(root, "depcruise", [
			"--config",
			".dependency-cruiser.mjs",
			"--output-type",
			"json",
			"server/src",
			"ui/src",
		]),
	) as Graph;
	findings.push(
		...compareImportGraph(
			new Map([...checker.scanImports()].map(([source, imports]) => [source, imports.map(canonicalSpecifier)])),
			graph.modules.map((module) => ({
				...module,
				dependencies: module.dependencies.map(({ module }) => ({ module: canonicalSpecifier(module) })),
			})),
		),
	);
	for (const source of graph.modules.filter(({ source }) => source.startsWith("ui/src/")))
		for (const edge of source.dependencies)
			if (edge.module === "@forge/api-contract" && edge.resolved !== "server/src/components/api-contract/index.ts")
				throw new Error(`Contract alias resolved outside its public entry: ${edge.resolved}`);
	return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const root = process.argv[2] ? resolve(process.argv[2]) : installation;
		const findings = checkUi(root);
		for (const finding of findings)
			process.stdout.write(`${finding.severity} ${finding.rule} ${finding.path}: ${finding.message}\n`);
		if (findings.some(({ severity }) => severity === "error")) process.exitCode = 1;
		else process.stdout.write("UI structure, TypeScript/Vitest collection and static graph agree.\n");
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
