import { join } from "node:path";
import { loadCurrentIssue, writeCurrentIssue } from "./current-issue.ts";
import {
	type ConcernReloadResult,
	type ConfigurationLocations,
	type ConfigurationRead,
	type ConfigurationReloadResult,
	type ConfigurationSource,
	diagnostic,
	type Loaded,
	type ServerRegistration,
} from "./types.ts";
import { loadServerHubUrl, loadServers } from "./user-files.ts";

interface Concern<T> {
	read(): ConfigurationRead<T>;
	reload(): Promise<ConcernReloadResult>;
	accept(value: T): void;
}

function createConcern<T>(
	scope: ConfigurationSource["scope"],
	path: string,
	load: () => Promise<Loaded<T>>,
): Concern<T> {
	let accepted: ConfigurationRead<T> = Object.freeze({
		available: false,
		source: Object.freeze({ scope, path, provenance: "file" }),
		diagnostic: "$: configuration has not been initialized",
	});
	return {
		read: () => accepted,
		accept(value) {
			accepted = Object.freeze({ available: true, value, source: Object.freeze({ scope, path, provenance: "file" }) });
		},
		async reload() {
			try {
				const loaded = await load();
				const source = Object.freeze({ scope, path, provenance: loaded.provenance });
				accepted = Object.freeze({ available: true, value: loaded.value, source });
				return Object.freeze({ status: "accepted", source, retainedPriorValue: false });
			} catch (error) {
				const source = Object.freeze({ scope, path, provenance: "file" as const });
				const message = diagnostic(error);
				const retainedPriorValue = accepted.available;
				if (!accepted.available) accepted = Object.freeze({ available: false, source, diagnostic: message });
				return Object.freeze({ status: "rejected", source, retainedPriorValue, diagnostic: message });
			}
		},
	};
}

export async function createConfiguration(deps: ConfigurationLocations) {
	const serverHubUrl = createConcern("user", join(deps.userConfigDirectory, "config.yaml"), () =>
		loadServerHubUrl(join(deps.userConfigDirectory, "config.yaml")),
	);
	const servers = createConcern<readonly ServerRegistration[]>(
		"user",
		join(deps.userConfigDirectory, "server-hub.yaml"),
		() => loadServers(join(deps.userConfigDirectory, "server-hub.yaml")),
	);
	const statePath = join(deps.guidanceDirectory, ".local", "state.json");
	const currentIssue = createConcern("workspace", statePath, () => loadCurrentIssue(statePath, deps.workspaceRoot));
	let tail: Promise<unknown> = Promise.resolve();
	function serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = tail.then(operation);
		tail = result.catch(() => undefined);
		return result;
	}
	async function reload(): Promise<ConfigurationReloadResult> {
		return serial(async () => {
			const [hub, registrations, selection] = await Promise.all([
				serverHubUrl.reload(),
				servers.reload(),
				currentIssue.reload(),
			]);
			return Object.freeze({
				ok: hub.status === "accepted" && registrations.status === "accepted" && selection.status === "accepted",
				concerns: Object.freeze({ serverHubUrl: hub, servers: registrations, currentIssue: selection }),
			});
		});
	}
	await reload();
	return {
		readServerHubUrl: serverHubUrl.read,
		readServers: servers.read,
		readCurrentIssue: currentIssue.read,
		reload,
		writeCurrentIssue(directory: string): Promise<void> {
			return serial(async () => currentIssue.accept(await writeCurrentIssue(statePath, deps.workspaceRoot, directory)));
		},
	};
}
