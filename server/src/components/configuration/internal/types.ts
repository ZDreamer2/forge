export interface ConfigurationLocations {
	readonly workspaceRoot: string;
	readonly userConfigDirectory: string;
	readonly guidanceDirectory: string;
}

export interface ConfigurationSource {
	readonly scope: "user" | "workspace";
	readonly path: string;
	readonly provenance: "file" | "default";
}

export interface ServerRegistration {
	readonly id: string;
	readonly name: string;
	readonly url: string;
}

export type ConfigurationRead<T> =
	| { readonly available: true; readonly value: T; readonly source: ConfigurationSource }
	| { readonly available: false; readonly source: ConfigurationSource; readonly diagnostic: string };

export type ConcernReloadResult =
	| { readonly status: "accepted"; readonly source: ConfigurationSource; readonly retainedPriorValue: false }
	| {
			readonly status: "rejected";
			readonly source: ConfigurationSource;
			readonly retainedPriorValue: boolean;
			readonly diagnostic: string;
	  };

export interface ConfigurationReloadResult {
	readonly ok: boolean;
	readonly concerns: {
		readonly serverHubUrl: ConcernReloadResult;
		readonly servers: ConcernReloadResult;
		readonly currentIssue: ConcernReloadResult;
	};
}

export class ConfigurationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ConfigurationError";
	}
}

export function diagnostic(error: unknown): string {
	return (error instanceof ConfigurationError ? error.message : "$: cannot read configuration source").slice(0, 320);
}

export interface Loaded<T> {
	readonly value: T;
	readonly provenance: "file" | "default";
}
