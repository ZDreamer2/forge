import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { WorkspaceConfig } from "../../workspace-config/index.ts";
import { loadAnalysisHandlers } from "../index.ts";

const execute = promisify(execFile);
test("native default function modules preserve configured occurrences and retain safe load failures", async () => {
	const dir = await mkdtemp(join(tmpdir(), "forge-handlers-"));
	try {
		await writeFile(join(dir, "package.json"), '{"type":"module"}');
		const good = join(dir, "authored # reset.ts");
		await writeFile(
			good,
			'type Value = string; const value: Value = "native"; export default function(root) { root.notice(value); }',
		);
		const bad = join(dir, "bad.mjs");
		await writeFile(bad, "export const named = () => {};");
		const throws = join(dir, "throws.mts");
		await writeFile(throws, 'throw new Error("private absolute filename");');
		const config: WorkspaceConfig = {
			repositories: [],
			codebaseTypes: [],
			analysisHandlers: [
				{ modulePath: good, ordinal: 1 },
				{ modulePath: bad, ordinal: 2 },
				{ modulePath: join(dir, "missing.js"), ordinal: 3 },
				{ modulePath: throws, ordinal: 4 },
			],
			codebases: [
				{
					root: join(dir, "app"),
					guide: dir,
					analysisHandlers: [
						{ modulePath: good, ordinal: 1 },
						{ modulePath: good, ordinal: 2 },
					],
				},
			],
		};
		const result = await loadAnalysisHandlers(config, dir);
		assert.deepEqual(
			result.map((item) => item.identity.id),
			["workspace:1", "workspace:2", "workspace:3", "workspace:4", "codebase:app:1", "codebase:app:2"],
		);
		assert.equal(result[0]?.handler, result[4]?.handler);
		assert.equal(result[4]?.handler, result[5]?.handler);
		for (const item of result.slice(1, 4)) {
			assert.ok(item.error);
			assert.equal(item.error.handler, item.identity);
			assert.equal(item.error.message.includes(dir), false);
		}
		assert.deepEqual(result[4]?.identity.codebase, { root: join(dir, "app"), guide: dir });
		await writeFile(good, 'export default function() { throw new Error("changed"); }');
		const cached = await loadAnalysisHandlers(config, dir);
		assert.equal(cached[0]?.handler, result[0]?.handler);
		const child = await execute(process.execPath, [
			"--input-type=module",
			"-e",
			`const loaded = await import(${JSON.stringify(pathToFileURL(good).href)}); try {loaded.default()} catch(error) {process.stdout.write(error.message)}`,
		]);
		assert.equal(child.stdout, "changed");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
