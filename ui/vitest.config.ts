import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [react()],
	test: {
		// App-level jsdom suites otherwise compete for CPU and exceed unchanged interaction deadlines.
		maxWorkers: 2,
		environment: "node",
		include: ["src/**/Tests/**/*.test.{ts,tsx}"],
		setupFiles: ["./vitest.setup.ts"],
		environmentOptions: { jsdom: { url: "http://localhost/" } },
	},
});
