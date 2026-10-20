import base from "@zdreamer/forge-ts-service/dependency-cruiser";

export default {
	...base,
	forbidden: [
		...base.forbidden,
		{
			name: "listed-component-edges-only",
			severity: "error",
			from: { path: "^src/components/([^/]+)/", pathNot: "^src/components/(workspace-api|workspace-changes)/" },
			to: { path: "^src/components/", pathNot: "^src/components/$1/" },
		},
		{
			name: "workspace-api-component-edges",
			severity: "error",
			from: { path: "^src/components/workspace-api/" },
			to: { path: "^src/components/", pathNot: "^src/components/(workspace-api|workspace-policy|workspace-changes)/" },
		},
		{
			name: "workspace-changes-component-edges",
			severity: "error",
			from: { path: "^src/components/workspace-changes/" },
			to: { path: "^src/components/", pathNot: "^src/components/(workspace-changes|workspace-policy)/" },
		},
		{
			name: "hono-confinement",
			severity: "error",
			from: {
				path: "^src/",
				pathNot: "^src/(app/http(?:\\.test)?\\.ts|components/workspace-api/|lib/loopback-access/)",
			},
			to: { path: "(^|/)hono/" },
		},
		{
			name: "node-adapter-confinement",
			severity: "error",
			from: { path: "^src/", pathNot: "^src/app/listener(?:\\.test)?\\.ts$" },
			to: { path: "(^|/)@hono/node-server/" },
		},
		{
			name: "no-unlisted-third-party-runtime",
			severity: "error",
			from: { path: "^src/" },
			to: {
				dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
				pathNot: "(^|/)(hono|@hono/node-server)/",
			},
		},
	],
};
