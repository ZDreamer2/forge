import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findCodebaseRoot,
	guideIdentity,
	mergeGuideSequences,
	type ResolvedGuideChain,
	resolveCodebaseChain,
	resolveGuideChain,
	resolveWorkspaceChain,
	rootedCodebases,
	type WorkspaceConfig,
} from "../index.ts";

function registry(
	declarations: Record<string, readonly string[]>,
	parents: readonly string[] = [],
	rooted = ["api"],
): WorkspaceConfig {
	const guides = Object.entries(declarations).map(([id, parents]) => ({
		id,
		guide: `/guides/${id}`,
		parents,
		...(rooted.includes(id) ? { root: `/sources/${id}` } : {}),
	}));
	return {
		workspace: { guide: "/workspace", parents },
		guides,
		unavailable: [],
		repositories: [],
	};
}
function names(chain: ResolvedGuideChain) {
	return chain.guides.map((guide) => ("id" in guide ? guide.id : "workspace"));
}
function selected(config: WorkspaceConfig, id = "api") {
	const guide = rootedCodebases(config).find((g) => g.id === id);
	assert.ok(guide);
	const result = resolveGuideChain(config, guide);
	assert.equal(result.selected, guide);
	const selectedRoot: string = result.selected.root;
	assert.equal(selectedRoot, guide.root);
	return result;
}

test("independent chains preserve ancestry, declaration order, shared identities and workspace priority", () => {
	const cases: [Record<string, string[]>, string[], string[]][] = [
		[{ api: [] }, [], ["workspace", "api"]],
		[{ api: ["ts"], ts: ["base"], base: [] }, ["base"], ["base", "workspace", "ts", "api"]],
		[{ api: ["X", "B"], X: [], B: [] }, ["B"], ["X", "B", "workspace", "api"]],
		[
			{ api: ["left", "right"], right: ["base"], left: ["base"], base: [] },
			["base"],
			["base", "workspace", "left", "right", "api"],
		],
		[{ api: ["child", "base"], child: ["base"], base: [] }, [], ["workspace", "base", "child", "api"]],
		[{ api: [], a: ["base"], b: ["base"], base: [] }, ["b", "a"], ["base", "b", "a", "workspace", "api"]],
		[
			{
				api: ["left", "right"],
				left: ["l1", "l2"],
				right: ["r1", "r2"],
				l1: ["base"],
				l2: [],
				r1: ["base"],
				r2: [],
				base: [],
			},
			[],
			["workspace", "base", "l1", "l2", "left", "r1", "r2", "right", "api"],
		],
	];
	for (const [declarations, parents, expected] of cases) {
		assert.deepEqual(names(selected(registry(declarations, parents))), expected);
		assert.deepEqual(
			names(selected(registry(Object.fromEntries(Object.entries(declarations).reverse()), parents))),
			expected,
		);
	}
});

test("selection survives an earlier chain position; workspace identity cannot collide with an ID", () => {
	const config = registry({ base: [], api: ["base"], outer: ["api"] }, ["outer"]);
	const result = selected(config);
	assert.deepEqual(names(result), ["base", "api", "outer", "workspace"]);
	assert.notEqual(result.selected, result.guides.at(-1));
	const collision = registry({ workspace: [], api: ["workspace"] }, ["workspace"]);
	const chain = selected(collision);
	assert.equal(chain.guides.length, 3);
	assert.equal(chain.guides[0], collision.guides[0]);
	assert.equal(chain.guides[1], collision.workspace);
});

test("workspace-only and independently selected rooted parents keep ownership separate", () => {
	const workspace = resolveWorkspaceChain(registry({}));
	const noSelection: undefined = workspace.selected;
	assert.equal(noSelection, undefined);
	assert.deepEqual(names(workspace), ["workspace"]);
	const config = registry(
		{ api: ["parent"], parent: ["base"], other: ["base"], base: [], broken: ["missing"] },
		["base"],
		["api", "parent", "other"],
	);
	assert.deepEqual(names(resolveWorkspaceChain(config)), ["base", "workspace"]);
	assert.deepEqual(names(selected(config)), ["base", "workspace", "parent", "api"]);
	assert.deepEqual(names(selected(config, "parent")), ["base", "workspace", "parent"]);
	assert.deepEqual(names(selected(config, "other")), ["base", "workspace", "other"]);
	assert.equal(findCodebaseRoot(config, "/sources/api/docs/.."), rootedCodebases(config)[0]);
	assert.equal(findCodebaseRoot(config, "/sources/api/child"), undefined);
	assert.equal(findCodebaseRoot(config, "/guides/api"), undefined);
	const rootless = config.guides.find((g) => g.id === "base");
	assert.ok(rootless);
	assert.throws(() => {
		// @ts-expect-error Rootless or unrefined registry entries cannot be selected.
		resolveGuideChain(config, rootless);
	}, /available registered rooted guide/);
	assert.throws(
		() => resolveGuideChain(config, { id: "outsider", guide: "/other", root: "/other", parents: [] }),
		/available registered rooted guide/,
	);
});

test("required unavailable ancestry identifies the origin, ID and recorded reason", () => {
	const config = registry({ api: ["parent"] });
	const unavailable = {
		...config,
		unavailable: [
			{ marker: "/parent/forge-codebase.yaml", id: "parent", reason: "root is missing: /absent" },
			{ marker: "/unknown/forge-codebase.yaml", reason: "marker is missing" },
		],
	};
	assert.throws(() => selected(unavailable), /api.*unavailable parent.*parent.*root is missing.*marker is missing/);
	assert.throws(() => resolveWorkspaceChain(registry({}, ["missing"])), /workspace.*unavailable parent.*missing/);
});

test("cycles and ordering contradictions fail atomically with identities and constraints", () => {
	for (const config of [
		registry({ api: ["api"] }),
		registry({ api: ["a"], a: ["b"], b: ["a"] }),
		registry({ api: [], a: ["b"], b: ["a"] }, ["a"]),
	]) {
		assert.throws(() => selected(config), /Ancestry cycle:.* -> /);
	}
	assert.throws(
		() => selected(registry({ api: ["left", "right"], left: ["a", "b"], right: ["b", "a"], a: [], b: [] })),
		/Contradictory ordering in ancestry.*api.*a.*b/,
	);
	const config = registry({ api: ["a", "b"], a: [], b: [] }, ["b", "a"]);
	const workspace = resolveWorkspaceChain(config);
	for (let attempt = 0; attempt < 2; attempt++)
		assert.throws(() => selected(config), /Contradictory ordering in workspace\/codebase chain merge.*a.*b/);
	assert.deepEqual(resolveWorkspaceChain(config), workspace);
	const first = config.guides[0];
	assert.ok(first);
	const duplicate = { ...config, guides: [...config.guides, first] };
	assert.throws(() => resolveWorkspaceChain(duplicate), /Duplicate codebase ID/);
});

test("independent owner ancestry avoids workspace tie constraints in a three-chain merge", () => {
	const config = registry({ api: ["a"], other: ["a", "b"], a: [], b: [] }, ["b"], ["api", "other"]);
	const workspace = resolveWorkspaceChain(config).guides;
	const api = rootedCodebases(config).find((guide) => guide.id === "api");
	const other = rootedCodebases(config).find((guide) => guide.id === "other");
	assert.ok(api && other);
	const apiChain = resolveCodebaseChain(config, api);
	const otherChain = resolveCodebaseChain(config, other);
	assert.deepEqual(apiChain.map(guideIdentity), ["codebase:a", "codebase:api"]);
	assert.deepEqual(mergeGuideSequences([workspace, apiChain, otherChain], "node example").map(guideIdentity), [
		"codebase:a",
		"codebase:b",
		"workspace",
		"codebase:api",
		"codebase:other",
	]);
	assert.throws(
		() =>
			mergeGuideSequences(
				[
					[api, other],
					[{ ...other }, { ...api }],
				],
				"node rename",
			),
		/Contradictory ordering in node rename/,
	);
});
