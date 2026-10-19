import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "forge-consumer-"));
function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
try {
	// Build explicitly: installation/packing never executes package lifecycle scripts.
	run("corepack", ["pnpm", "--config.verify-deps-before-run=error", "run", "build"], root);
	const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root));
	const consumer = join(temporary, "consumer");
	mkdirSync(consumer);
	writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--save-dev",
			"--save-exact",
			join(temporary, packed[0].filename),
		],
		consumer,
	);
	const installed = join(consumer, "node_modules/@zdreamer/forge");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const installedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
	assert.equal(installedManifest.name, manifest.name);
	assert.equal(installedManifest.version, manifest.version);
	assert.equal(installedManifest.license, "MIT");
	assert.match(readFileSync(join(installed, "LICENSE"), "utf8"), /MIT License/);
	assert.ok(
		packed[0].files.every((file: { path: string }) => /^(dist\/|package.json$|README.md$|LICENSE$)/.test(file.path)),
	);
	const policy = join(consumer, "workspace.ts");
	writeFileSync(
		policy,
		`import type { WorkspacePolicy } from '@zdreamer/forge/workspace';
export default {
  repositories: [{ path: '.' }, { path: 'not-cloned' }],
  codebasesForChange: () => [{ id: 'example', guidance: 'docs/code' }],
} satisfies WorkspacePolicy;
`,
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2024",
				module: "NodeNext",
				types: [],
			},
			include: ["workspace.ts"],
		}),
	);
	const compiler = join(root, "node_modules/.bin/tsc");
	run(compiler, ["--project", consumer], consumer);
	const executable = join(consumer, "node_modules/.bin/forge");
	assert.deepEqual(JSON.parse(run(executable, ["inspect-workspace", policy, ".", "example.ts"], consumer)), {
		included: true,
		codebases: [{ id: "example", guidance: "docs/code" }],
	});
	writeFileSync(
		policy,
		"import type { WorkspacePolicy } from '@zdreamer/forge/workspace';\nexport default { repositories: [{path: 123}], codebasesForChange: () => [] } satisfies WorkspacePolicy;\n",
	);
	const invalid = spawnSync(compiler, ["--project", consumer], { encoding: "utf8" });
	assert.notEqual(invalid.status, 0);
	assert.match(invalid.stdout, /not assignable to type 'string'/);
	if (process.argv[2] !== undefined) {
		copyFileSync(resolve(process.argv[2]), policy);
		run(compiler, ["--project", consumer], consumer);
		JSON.parse(run(executable, ["inspect-workspace", policy, ".", "package.json"], consumer));
	}
	console.log(
		"Tarball-only consumer: executable, public types, invalid contract rejection and optional workspace module passed.",
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
