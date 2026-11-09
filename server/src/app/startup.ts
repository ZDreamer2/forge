import { basename } from "node:path";
import { loadGuideExtensions } from "../components/guide-extensions/index.ts";
import { AnalysisHandlerError, createTreeAnalyzer } from "../components/tree-analysis/index.ts";
import { createWorkingChanges } from "../components/tree-sources/index.ts";
import {
	loadWorkspaceConfig,
	resolveGuideChain,
	resolveWorkspaceChain,
	rootedCodebases,
} from "../components/workspace-config/index.ts";
import { resolveRepositories } from "../components/workspace-repositories/index.ts";
import { createGitProcess } from "../lib/git/index.ts";
import { createAnalysis } from "./analysis.ts";
import { createCollection } from "./collection.ts";
import { loadConfig } from "./config.ts";
import { createFileRequests } from "./file-requests.ts";
import { createHttpApp } from "./http.ts";
import { createListener } from "./listener.ts";
import { createRequestRuns } from "./request-runs.ts";

type Options = {
	workspace: string;
	cwd: string;
	env: Readonly<Record<string, string | undefined>>;
};

export async function start(options: Options) {
	const config = await loadConfig(options);
	const workspaceConfig = await loadWorkspaceConfig(config.configPath);
	const codebases = rootedCodebases(workspaceConfig);
	resolveWorkspaceChain(workspaceConfig);
	for (const codebase of codebases) resolveGuideChain(workspaceConfig, codebase);
	const git = createGitProcess(options.env);
	const repositories = await resolveRepositories(config.root, workspaceConfig.repositories, git);
	const name = workspaceConfig.displayName ?? (basename(config.root) || config.root);
	const snapshot = Object.freeze({ root: config.root, name, workspaceConfig, repositories });
	const changes = createWorkingChanges({
		root: config.root,
		repositories,
		codebases,
		git,
	});
	const extensions = await loadGuideExtensions(workspaceConfig);
	for (const registration of extensions) {
		if (registration.error) {
			const diagnostic = registration.error
				.diagnostic()
				.replace(/\p{Cc}/gu, " ")
				.slice(0, 1600);
			console.error(`Forge analysis handler unavailable (${registration.id}): ${diagnostic}`);
		}
	}
	const analyzer = createTreeAnalyzer({ config: workspaceConfig, extensions });
	const analysis = createAnalysis();
	const fileRequests = createFileRequests();
	const changesRequests = createRequestRuns({ operation: "Workspace changes" });
	const collection = createCollection({ collect: (signal) => changes.discover(signal) });
	const app = createHttpApp({
		...snapshot,
		discoverChanges: collection.collect,
		materializeChanges: changes.materialize,
		changesRequests,
		analysis,
		fileRequests,
		fileDiff: changes.fileDiff,
		analyze: analyzer.analyze,
		currentByteSize: changes.currentByteSize,
		port: config.port,
		reportError: (error) => {
			const causes: string[] = [];
			let current: unknown = error;
			while (current instanceof Error && causes.length < 3) {
				causes.push(
					current instanceof AnalysisHandlerError ? `${current.message}: ${current.diagnostic()}` : current.message,
				);
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
			disposal = Promise.all([
				analysis.close(),
				fileRequests.close(),
				changesRequests.close(),
				collection.close(),
				listener.close(),
			]).then(() => {});
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
