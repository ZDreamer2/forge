import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const owners = /^(?:server\/src\/(?:app|(?:components|lib)\/[^/]+(?:\/internal\/[^/]+)*)|tools|scripts)\/tests\//;
const violations: string[] = [];
function inspect(directory: string) {
	for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
		const path = directory ? `${directory}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (![".git", "node_modules", "dist", "ui"].includes(entry.name)) inspect(path);
		} else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) && !owners.test(path)) {
			violations.push(path);
		}
	}
}
inspect("");
if (violations.length) {
	throw new Error(`Tests must use lowercase owner-local tests/ folders:\n${violations.join("\n")}`);
}
