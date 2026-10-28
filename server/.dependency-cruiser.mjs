import { readdirSync } from "node:fs";
import base from "@zdreamer/forge-ts-service/dependency-cruiser";

// Each nested unit's private directory is protected independently, so tests keep
// parent vocabulary access without gaining sibling/uncle implementation access.
const nestedInternals = readdirSync("src", { recursive: true })
	.map((path) => `src/${path.replaceAll("\\", "/")}`)
	.filter((path) => /\/internal\/[^/]+\/internal$/.test(path));
function literal(path) {
	return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default {
	...base,
	forbidden: [
		...base.forbidden.map((rule) => {
			if (rule.name === "not-to-foreign-internal") {
				return { ...rule, from: { path: "^(.+?)/(?:internal|tests)/|^(.+)/[^/]+\\.ts$" } };
			}
			if (rule.name === "not-to-nested-internal") {
				return {
					...rule,
					from: { path: "^(.+)/tests/|^(.+)/index\\.ts$|^(.+)/internal/[^/]+\\.ts$|^(.+)/[^/]+\\.ts$" },
				};
			}
			return rule;
		}),
		...nestedInternals.map((path) => ({
			name: `tests-respect-unit-boundary:${path}`,
			severity: "error",
			from: { path: "/tests/", pathNot: `^${literal(path.slice(0, -"/internal".length))}/` },
			to: { path: `^${literal(path)}/` },
		})),
		{
			name: "production-not-to-tests",
			severity: "error",
			from: { path: "^src/", pathNot: "/tests/" },
			to: { path: "/tests/" },
		},
		{
			name: "api-contract-is-independent",
			severity: "error",
			from: { path: "^src/components/api-contract/" },
			to: { pathNot: "^src/components/api-contract/" },
		},
		{
			name: "listed-component-edges-only",
			severity: "error",
			from: {
				path: "^src/components/([^/]+)/",
				pathNot: "^src/components/(workspace-repositories|workspace-tree|tree-sources|http-api)/",
			},
			to: { path: "^src/components/", pathNot: "^src/components/$1/" },
		},
		...Object.entries({
			"workspace-repositories": ["workspace-config"],
			"workspace-tree": ["workspace-config"],
			"tree-sources": ["workspace-tree", "workspace-repositories", "workspace-config"],
			"http-api": ["tree-sources", "workspace-tree", "workspace-repositories", "workspace-config", "api-contract"],
		}).map(([component, dependencies]) => ({
			name: `${component}-component-edges`,
			severity: "error",
			from: { path: `^src/components/${component}/` },
			to: { path: "^src/components/", pathNot: `^src/components/(${[component, ...dependencies].join("|")})/` },
		})),
		{
			name: "hono-confinement",
			severity: "error",
			from: {
				path: "^src/",
				pathNot:
					"^src/(app/(?:http\\.ts|tests/http\\.test\\.ts)|components/(http-api|diagnostic-ui)/|lib/loopback-access/)",
			},
			to: { path: "(^|/)hono/" },
		},
		{
			name: "node-adapter-confinement",
			severity: "error",
			from: { path: "^src/", pathNot: "^src/app/(?:listener\\.ts|tests/listener\\.test\\.ts)$" },
			to: { path: "(^|/)@hono/node-server/" },
		},
		{
			name: "yaml-confinement",
			severity: "error",
			from: { path: "^src/", pathNot: "^src/components/workspace-config/" },
			to: { path: "(^|/)yaml/" },
		},
		{
			name: "no-unlisted-third-party-runtime",
			severity: "error",
			from: { path: "^src/" },
			to: {
				dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
				pathNot: "(^|/)(hono|@hono/node-server|yaml)/",
			},
		},
	],
};
