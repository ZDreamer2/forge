import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function installationLintPaths(root: string): string[] {
	return [
		"tools",
		...readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isFile() && /\.(?:json|mjs)$/.test(entry.name))
			.map((entry) => entry.name)
			.sort(),
	];
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const result = spawnSync(join(root, "node_modules/.bin/biome"), ["check", ...installationLintPaths(root)], {
		cwd: root,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	process.exitCode = result.status ?? 1;
}
