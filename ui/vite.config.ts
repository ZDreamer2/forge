import { readFileSync } from "node:fs";
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
		{
			name: "workspace-asset-notices",
			generateBundle() {
				for (const [source, name] of [
					["WorkspaceReview/Internal/Assets/OFL.txt", "OFL.txt"],
					[
						"WorkspaceReview/Components/ChangesNavigator/Components/ChangesTree/Internal/Assets/icons/LICENSE",
						"icons-LICENSE",
					],
					[
						"WorkspaceReview/Components/ChangesNavigator/Components/ChangesTree/Internal/Assets/icons/SOURCE.txt",
						"icons-SOURCE.txt",
					],
				]) {
					this.emitFile({
						type: "asset",
						fileName: `assets/licenses/${name}`,
						source: readFileSync(new URL(`src/Components/${source}`, import.meta.url)),
					});
				}
			},
		},
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
		license: { fileName: "assets/licenses/dependencies.md" },
		assetsInlineLimit: 0,
		outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
		emptyOutDir: true,
	},
});
