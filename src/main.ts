#!/usr/bin/env node
import { inspect } from "./app/inspect.ts";

const [command, modulePath, repo, path, from, ...extra] = process.argv.slice(2);
if (command === "--help" || command === undefined) {
	console.log("forge inspect-workspace <workspace.ts> <repository> <path> [previous-path]");
} else if (
	command !== "inspect-workspace" ||
	modulePath === undefined ||
	repo === undefined ||
	path === undefined ||
	extra.length > 0
) {
	console.error("Usage: forge inspect-workspace <workspace.ts> <repository> <path> [previous-path]");
	process.exitCode = 1;
} else {
	try {
		console.log(JSON.stringify(await inspect(modulePath, repo, path, from)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
