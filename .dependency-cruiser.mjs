import base from "@zdreamer/forge-ts-service/dependency-cruiser";

const contract = "^server/src/components/api-contract/";

// Installation boundaries complement, rather than replace, server-local zone rules.
export default {
	forbidden: [
		{
			name: "source-not-to-installation-entrypoints",
			severity: "error",
			from: { path: "^(server|ui)/src/" },
			to: { path: "^(tools|scripts)/" },
		},
		{
			name: "browser-not-to-server-internals",
			severity: "error",
			from: { path: "^ui/src/" },
			to: { path: "^server/", pathNot: `${contract}index\\.ts$` },
		},
		{
			name: "server-not-to-ui",
			severity: "error",
			from: { path: "^server/src/" },
			to: { path: "^ui/" },
		},
		{
			name: "api-contract-is-independent",
			severity: "error",
			from: { path: contract },
			to: { pathNot: contract },
		},
		{
			name: "browser-not-to-node",
			severity: "error",
			from: { path: `^ui/src/|${contract}` },
			to: { dependencyTypes: ["core"] },
		},
		{
			name: "api-contract-public-entry-only",
			severity: "error",
			from: { path: "^(server|ui)/src/", pathNot: contract },
			to: { path: contract, pathNot: `${contract}index\\.ts$` },
		},
		{ name: "no-circular", severity: "error", from: {}, to: { circular: true } },
	],
	options: {
		...base.options,
		enhancedResolveOptions: {
			...base.options.enhancedResolveOptions,
			extensions: [".tsx", ...base.options.enhancedResolveOptions.extensions],
		},
	},
};
