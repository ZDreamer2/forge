import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { WorkspaceConfig } from "../../workspace-config/index.ts";
import { GuideExtensionLoadError, loadGuideExtensions } from "../index.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "forge-extensions-"));
	const config: WorkspaceConfig = {
		repositories: [],
		unavailable: [],
		workspace: { guide: join(root, "workspace"), parents: ["base"] },
		guides: [
			{ id: "base", guide: join(root, "base"), parents: [] },
			{ id: "app", guide: join(root, "app"), root: join(root, "sources"), parents: ["base"] },
			{ id: "unused", guide: join(root, "unused"), parents: ["missing"] },
		],
	};
	async function write(path: string, content: string) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return { root, config, write, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("discovers distinct adopted guides only and imports explicit local TypeScript modules once", async () => {
	const f = await fixture();
	try {
		await f.write("base/forge-extension/internal/policy.ts", "export const annotateNode = () => {};\n");
		await f.write(
			"base/forge-extension/forge-extension.ts",
			"import { annotateNode } from './internal/policy.ts'; export default { api: 1, annotateNode };\n",
		);
		await f.write(
			"workspace/forge-extension/forge-extension.ts",
			"export default { api: 1 }; // classifyNode is only a comment\n",
		);
		await f.write("unused/forge-extension/forge-extension.ts", "throw new Error('must not load');\n");
		const first = await loadGuideExtensions(f.config);
		assert.deepEqual(
			first.map((item) => item.id),
			["codebase:base", "workspace"],
		);
		assert.equal(typeof first[0]?.annotateNode, "function");
		assert.equal(first[1]?.annotateNode, undefined);
		await f.write("base/forge-extension/forge-extension.ts", "throw new Error('cached until process restart');\n");
		const second = await loadGuideExtensions(f.config);
		assert.equal(second[0]?.annotateNode, first[0]?.annotateNode);
		assert.ok(second.every((item) => item.error === undefined));
	} finally {
		await f.cleanup();
	}
});

test("retains each guide failure without exposing raw causes in public errors", async () => {
	for (const source of [
		"export const other = {};",
		"export default () => {};",
		"export default [];",
		"export default null;",
		"export default new Date();",
		"export default { api: 2 };",
		"export default { annotateNode() {} };",
		"export default { api: 1, annotateNode: undefined };",
		"export default { api: 1, annotateNode: true };",
		"export default { api: 1, classifyNode: undefined };",
		"export default { api: 1, classifyNode: true };",
		"export default { api: 1, checkDiff() {} };",
		"export default { api: 1, [Symbol('unknown')]: true };",
		"throw new Error('secret absolute path');",
		"import './missing.ts'; export default { api: 1 };",
	]) {
		const f = await fixture();
		try {
			await f.write("base/forge-extension/forge-extension.ts", source);
			await f.write("app/forge-extension/forge-extension.ts", "export default { api: 1, annotateNode() {} };\n");
			const extensions = await loadGuideExtensions(f.config);
			assert.equal(extensions.length, 2, source);
			const error = extensions[0]?.error;
			assert.ok(error instanceof GuideExtensionLoadError, source);
			assert.equal(error.message, "Guide extension failed to load: codebase:base");
			assert.equal(error.cause, undefined);
			assert.ok(error.diagnostic().length > 0);
			assert.equal(extensions[1]?.id, "codebase:app");
			assert.equal(typeof extensions[1]?.annotateNode, "function");
		} finally {
			await f.cleanup();
		}
	}
});

test("an absent extension contributes nothing; a present unit requires the fixed entry", async () => {
	const f = await fixture();
	try {
		assert.deepEqual(await loadGuideExtensions(f.config), []);
		await f.write("base/forge-extension/other.ts", "export default { api: 1 };\n");
		const result = await loadGuideExtensions(f.config);
		assert.equal(result.length, 1);
		assert.ok(result[0]?.error instanceof GuideExtensionLoadError);
		assert.match(result[0].error.diagnostic(), /forge-extension\.ts/);
	} finally {
		await f.cleanup();
	}
});

test("validates every rooted chain before module execution", async () => {
	const f = await fixture();
	try {
		await f.write("base/forge-extension/forge-extension.ts", "throw new Error('must not execute');\n");
		const broken: WorkspaceConfig = {
			...f.config,
			guides: [...f.config.guides, { id: "broken", root: f.root, guide: join(f.root, "broken"), parents: ["absent"] }],
		};
		await assert.rejects(loadGuideExtensions(broken), /unavailable parent.*absent/);
	} finally {
		await f.cleanup();
	}
});

test("loads classifier-only, annotation-only and both-hook entries", async () => {
	const f = await fixture();
	try {
		for (const [guide, hooks] of [
			["base", "classifyNode(ctx) { ctx.classify('docs'); }"],
			["workspace", "annotateNode() {}"],
			["app", "classifyNode() {}, annotateNode() {}"],
		])
			await f.write(`${guide}/forge-extension/forge-extension.ts`, `export default { api: 1, ${hooks} };`);
		const result = await loadGuideExtensions(f.config);
		assert.deepEqual(
			result.map(({ id, classifyNode, annotateNode, error }) => ({
				id,
				classify: typeof classifyNode,
				annotate: typeof annotateNode,
				error,
			})),
			[
				{ id: "codebase:base", classify: "function", annotate: "undefined", error: undefined },
				{ id: "workspace", classify: "undefined", annotate: "function", error: undefined },
				{ id: "codebase:app", classify: "function", annotate: "function", error: undefined },
			],
		);
	} finally {
		await f.cleanup();
	}
});
