import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceConfig } from "../../workspace-config/index.ts";
import { resolveWorkspaceGuidance } from "../index.ts";

const root = "/workspace";
const guide = (id: string, parents: string[] = [], sourceRoot?: string) => ({
	id,
	parents,
	guide: `${root}/guides/${id}`,
	...(sourceRoot === undefined ? {} : { root: `${root}/${sourceRoot}` }),
});

function registry(guides: WorkspaceConfig["guides"], parents: string[]): WorkspaceConfig {
	return { workspace: { guide: `${root}/docs/forge/workspace`, parents }, guides, repositories: [], unavailable: [] };
}

test("guidance projects authoritative merged order, shared ancestry and selected role without physical ancestors", () => {
	const config = registry(
		[
			guide("B"),
			guide("X"),
			guide("API", ["X", "B"], "app/api"),
			guide("physical-only", [], "app"),
			guide("root-owner", [], "."),
		],
		["B"],
	);
	const result = resolveWorkspaceGuidance(root, "Literal workspace", config);
	assert.deepEqual(result.workspace, [
		{ id: "codebase:B", name: "B", guidance: "guides/B", source: "workspace-parent" },
		{ id: "workspace", name: "Literal workspace", root: ".", guidance: "docs/forge/workspace", source: "workspace" },
	]);
	assert.deepEqual(result.codebases["app/api"], [
		{ id: "codebase:X", name: "X", guidance: "guides/X", source: "project-parent" },
		result.workspace[0],
		result.workspace[1],
		{ id: "codebase:API", name: "API", root: "app/api", guidance: "guides/API", source: "project-folder" },
	]);
	assert.deepEqual(Object.keys(result.codebases), ["app/api", "app", "."]);
	assert.equal(result.codebases["."]?.at(-1)?.root, ".");
});

test("workspace-inherited selected guide keeps its resolver position but takes project-folder source", () => {
	const config = registry([guide("shared"), guide("selected", ["shared"], "selected")], ["selected"]);
	const result = resolveWorkspaceGuidance(root, "Workspace", config);
	assert.deepEqual(
		result.codebases.selected?.map(({ id, source }) => [id, source]),
		[
			["codebase:shared", "workspace-parent"],
			["codebase:selected", "project-folder"],
			["workspace", "workspace"],
		],
	);
	assert.equal(result.workspace[1]?.source, "workspace-parent");
});

test("guidance retains rootless external directories, safe owner keys and explicit diamond ancestry once", () => {
	const config = registry(
		[
			{ id: "external", guide: "/outside/conventions", parents: [] },
			guide("left", ["external"]),
			guide("right", ["external"]),
			guide("special", ["left", "right"], "__proto__"),
		],
		["external"],
	);
	const result = resolveWorkspaceGuidance(root, "Workspace", config);
	const ownerRoot = "__proto__";
	assert.equal(Object.hasOwn(result.codebases, ownerRoot), true);
	assert.deepEqual(
		result.codebases[ownerRoot]?.map(({ id }) => id),
		["codebase:external", "workspace", "codebase:left", "codebase:right", "codebase:special"],
	);
	assert.deepEqual(result.workspace[0], {
		id: "codebase:external",
		name: "external",
		guidance: "/outside/conventions",
		source: "workspace-parent",
	});
	assert.equal("root" in (result.workspace[0] ?? {}), false);
	assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("guidance refuses invalid startup composition even for owners without changes", () => {
	const config = registry([guide("unused", ["missing"], "unused")], []);
	assert.throws(() => resolveWorkspaceGuidance(root, "Workspace", config), /unavailable parent/);
});
