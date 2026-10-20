import { loadWorkspacePolicy, resolveRepositories } from "../components/workspace-policy/index.ts";
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
	const policy = await loadWorkspacePolicy(config.policyPath);
	const repositories = await resolveRepositories(config.root, policy.repositories);
	const snapshot = Object.freeze({ root: config.root, policy, repositories });
	const app = createHttpApp({ ...snapshot, port: config.port });
	const listener = await createListener({ fetch: app.fetch, port: config.port });
	let disposal: Promise<void> | undefined;
	function close(): Promise<void> {
		if (disposal === undefined) {
			process.off("SIGINT", terminate);
			process.off("SIGTERM", terminate);
			disposal = listener.close();
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
