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
			workspace: { guide: dir, parents: [] },
			unavailable: [],
			analysisHandlers: [
				{ modulePath: good, ordinal: 1 },
				{ modulePath: bad, ordinal: 2 },
				{ modulePath: join(dir, "missing.js"), ordinal: 3 },
				{ modulePath: throws, ordinal: 4 },
			],
			guides: [
				{
					id: "application-service",
					parents: [],
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
		assert.deepEqual(result[4]?.identity.codebase, { id: "application-service", root: join(dir, "app"), guide: dir });
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

test("composition never schedules inherited handlers; rooted reusable guides run only as registered owners", async () => {
	const dir = await mkdtemp(join(tmpdir(), "forge-handler-composition-"));
	try {
		const modulePath = join(dir, "handler.mjs");
		await writeFile(modulePath, "export default function() {}");
		const rootless = { id: "conventions", guide: dir, parents: [], analysisHandlers: [{ modulePath, ordinal: 1 }] };
		const reusable = {
			id: "reusable",
			guide: dir,
			root: join(dir, "base"),
			parents: [rootless.id],
			analysisHandlers: [{ modulePath, ordinal: 1 }],
		};
		const application = {
			id: "application",
			guide: dir,
			root: join(dir, "app"),
			parents: [reusable.id],
			analysisHandlers: [{ modulePath, ordinal: 1 }],
		};
		const config: WorkspaceConfig = {
			repositories: [],
			workspace: { guide: dir, parents: [rootless.id] },
			unavailable: [],
			guides: [rootless, reusable, application],
		};
		const result = await loadAnalysisHandlers(config, dir);
		assert.deepEqual(
			result.map(({ identity }) => identity.id),
			["codebase:base:1", "codebase:app:1"],
		);
		assert.deepEqual(
			result.map(({ identity }) => identity.codebase?.id),
			["reusable", "application"],
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
