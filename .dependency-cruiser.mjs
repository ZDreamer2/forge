import base from "@zdreamer/forge-ts-service/dependency-cruiser";

export default {
	...base,
	forbidden: [
		...base.forbidden,
		{
			name: "no-component-edges",
			severity: "error",
			from: { path: "^src/components/([^/]+)/" },
			to: { path: "^src/components/", pathNot: "^src/components/$1/" },
		},
		{
			name: "no-third-party-runtime",
			severity: "error",
			from: { path: "^src/" },
			to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"] },
		},
	],
};
