import { basename } from "node:path";
import { createWorkingChanges } from "../components/tree-sources/index.ts";
import { loadWorkspaceConfig } from "../components/workspace-config/index.ts";
import { resolveRepositories } from "../components/workspace-repositories/index.ts";
import { createGitProcess } from "../lib/git/index.ts";
import { createCollection } from "./collection.ts";
import { loadConfig } from "./config.ts";
import { createHttpApp } from "./http.ts";
import { createListener } from "./listener.ts";

type Options = {
	workspace: string;
	cwd: string;
	env: Readonly<Record<string, string | undefined>>;
};

export async function start(options: Options) {
	const config = await loadConfig(options);
	const workspaceConfig = await loadWorkspaceConfig(config.configPath);
	const git = createGitProcess(options.env);
	const repositories = await resolveRepositories(config.root, workspaceConfig.repositories, git);
	const name = workspaceConfig.displayName ?? (basename(config.root) || config.root);
	const snapshot = Object.freeze({ root: config.root, name, workspaceConfig, repositories });
	const changes = createWorkingChanges({
		root: config.root,
		repositories,
		codebases: workspaceConfig.codebases,
		git,
	});
	const collection = createCollection({ collect: (signal) => changes.collect(signal) });
	const app = createHttpApp({
		...snapshot,
		collectChanges: collection.collect,
		port: config.port,
		reportError: (error) => {
			const causes: string[] = [];
			let current: unknown = error;
			while (current instanceof Error && causes.length < 3) {
				causes.push(current.message);
				current = current.cause;
			}
			const message = causes
				.join(": ")
				.replace(/\p{Cc}/gu, " ")
				.slice(0, 1600);
			console.error(`Forge workspace request failed: ${message}`);
		},
	});
	const listener = await createListener({ fetch: app.fetch, port: config.port });
	let disposal: Promise<void> | undefined;
	function close(): Promise<void> {
		if (disposal === undefined) {
			process.off("SIGINT", terminate);
			process.off("SIGTERM", terminate);
			disposal = Promise.all([collection.close(), listener.close()]).then(() => {});
		}
		return disposal;
	}
	function terminate() {
		void close().catch(() => {
			console.error("Forge shutdown failed");
			process.exitCode = 1;
		});
	}
	process.on("SIGINT", terminate);
	process.on("SIGTERM", terminate);
	return { address: listener.address, close, snapshot };
}
