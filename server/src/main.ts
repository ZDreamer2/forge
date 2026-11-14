#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { fileURLToPath } from "node:url";
import { start } from "./app/startup.ts";

const usage = "forge serve --workspace <path> [--server-hub]";
const [command, ...args] = process.argv.slice(2);
let workspace: string | undefined;
let serverHub = false;
let valid = command === "serve";
for (let index = 0; valid && index < args.length; index++) {
	const argument = args[index];
	if (argument === "--server-hub" && !serverHub) {
		serverHub = true;
	} else if (argument === "--workspace" && workspace === undefined) {
		const value = args[++index];
		if (value === undefined || value === "" || value.startsWith("--")) valid = false;
		else workspace = value;
	} else {
		valid = false;
	}
}
try {
	if ((command === "--help" && args.length === 0) || command === undefined) {
		console.log(usage);
	} else if (valid && workspace !== undefined) {
		const manifestPath = findPackageJSON(import.meta.url);
		if (manifestPath === undefined) throw new Error("Forge package manifest was not found");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
			version: string;
		};
		const server = await start({ workspace, serverHub, cwd: process.cwd(), env: process.env });
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
