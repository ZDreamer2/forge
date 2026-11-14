import type { ServerRegistration } from "../../configuration/index.ts";

export interface ServerAvailability {
	readonly status: "unknown" | "reachable" | "unavailable";
	readonly checkedAt: string | null;
	readonly lastReachableAt: string | null;
	readonly error: string | null;
	readonly stale: boolean;
}

export interface ObservedServer extends ServerRegistration {
	readonly availability: ServerAvailability;
}

export interface ServerHubSnapshot {
	readonly servers: readonly ObservedServer[];
}

export interface ServerHub {
	inspect(): ServerHubSnapshot | null;
	replaceServers(servers: readonly ServerRegistration[] | null): Promise<void>;
	start(): void;
	close(): Promise<void>;
}

export interface ProbeDependencies {
	readonly fetch: typeof globalThis.fetch;
	readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimeout: (handle: unknown) => void;
}

export type ProbeResult =
	| { readonly status: "reachable"; readonly error: null }
	| { readonly status: "unavailable"; readonly error: string };

export function unavailable(error: string): ProbeResult {
	return { status: "unavailable", error: error.slice(0, 320) };
}

export type SelectedHubSource =
	| { readonly status: "selected"; readonly url: string }
	| { readonly status: "unconfigured" }
	| { readonly status: "configuration-unavailable"; readonly error: string };

export interface SelectedHubSnapshot {
	readonly source: { readonly status: SelectedHubSource["status"]; readonly url: string | null };
	readonly servers: readonly ObservedServer[] | null;
	readonly lastSuccessAt: string | null;
	readonly error: string | null;
	readonly stale: boolean;
}

export interface SelectedHub {
	inspect(): SelectedHubSnapshot;
	replaceSource(source: SelectedHubSource): Promise<void>;
	start(): void;
	close(): Promise<void>;
}
