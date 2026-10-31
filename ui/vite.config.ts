import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root,
	plugins: [
		tanstackRouter({
			target: "react",
			routesDirectory: fileURLToPath(new URL("src/Routes", import.meta.url)),
			generatedRouteTree: fileURLToPath(new URL("src/Routes/routeTree.gen.ts", import.meta.url)),
			routeFileIgnorePattern: "routeTree\\.gen\\.ts$",
		}),
		react(),
	],
	resolve: {
		alias: [
			{
				find: /^@forge\/api-contract$/,
				replacement: fileURLToPath(new URL("../server/src/components/api-contract/index.ts", import.meta.url)),
			},
		],
	},
	build: {
		outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
		emptyOutDir: true,
	},
});
