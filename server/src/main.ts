#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { fileURLToPath } from "node:url";
import { start } from "./app/startup.ts";

const usage = "forge serve --workspace <path>";
const [command, ...args] = process.argv.slice(2);
try {
	if (command === "--help" || command === undefined) {
		console.log(usage);
	} else if (command === "serve" && args.length === 2 && args[0] === "--workspace" && args[1] !== "") {
		const manifestPath = findPackageJSON(import.meta.url);
		if (manifestPath === undefined) throw new Error("Forge package manifest was not found");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			version: string;
		};
		const server = await start({ workspace: args[1] as string, cwd: process.cwd(), env: process.env });
		console.log(
			`Forge @zdreamer/forge ${manifest.version}\nExecutable: ${JSON.stringify(fileURLToPath(import.meta.url))}\nWorkspace: ${JSON.stringify(server.snapshot.root)}\n${server.address}`,
		);
	} else {
		console.error(`Usage: ${usage}`);
		process.exitCode = 1;
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
