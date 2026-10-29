import assert from "node:assert/strict";
import { test } from "node:test";
import { type AnalysisNode, createAnalysisTree, createWorkspaceTree, finalizeAnalysis } from "../index.ts";

function fixture() {
	const base = createWorkspaceTree({ root: "/workspace", codebases: [], repositories: [{ path: "." }] });
	base.insert({
		repo: ".",
		path: "tests/critical/a",
		current: { kind: "file" },
		statistics: { added: 4, removed: 2, binary: false },
	});
	base.insert({
		repo: ".",
		path: "tests/b",
		current: { kind: "file" },
		statistics: { added: 7, removed: 3, binary: false },
	});
	base.insert({
		repo: ".",
		path: "destination/moved",
		from: "former/moved",
		kind: "renamed",
		renameContentChanged: true,
		base: { kind: "file" },
		current: { kind: "file" },
		statistics: { added: 2, removed: 1, binary: false },
	});
	base.insert({
		repo: ".",
		path: "mixed",
		base: { kind: "file" },
		current: { kind: "directory" },
		statistics: { added: 1, removed: 4, binary: false },
	});
	base.insert({
		repo: ".",
		path: "mixed/child",
		current: { kind: "file" },
		statistics: { added: 5, removed: 0, binary: false },
	});
	return base;
}
test("run facade navigation, independent annotations, final inheritance and own-plus-child totals", () => {
	const base = fixture();
	let identity = { id: "first" };
	const deps = { currentHandler: () => identity, checkActive: () => {} };
	const a = createAnalysisTree(base, deps);
	const b = createAnalysisTree(base, deps);
	const tests = a.nodes.get("tests");
	const critical = a.nodes.get("tests/critical");
	assert.ok(tests && critical);
	tests.deemphasize("tests");
	tests.warn("Visible through deemphasis");
	critical.restoreNormalEmphasis();
	const hidden = a.nodes.get("tests/b");
	assert.ok(hidden);
	hidden.hide("noise");
	hidden.warn("Still visible");
	identity = { id: "second" };
	critical.emphasize("important");
	assert.equal(critical.emphasis?.handler.id, "second");
	assert.equal(critical.parent, tests);
	assert.equal(tests.children[0], hidden);
	assert.equal(a.root.parent, undefined);
	assert.deepEqual(
		[...critical.walk()].map((n) => n.path),
		["tests/critical", "tests/critical/a"],
	);
	const final = finalizeAnalysis(a);
	assert.deepEqual(final.nodes.get(".")?.rawTotals, { added: 19, removed: 10 });
	assert.deepEqual(final.nodes.get(".")?.attentionTotals, { added: 12, removed: 7 });
	assert.deepEqual(final.nodes.get(".")?.signalCounts, { notice: 0, warning: 2 });
	assert.deepEqual(final.nodes.get("former")?.rawTotals, { added: 0, removed: 0 });
	assert.deepEqual(final.nodes.get("mixed")?.rawTotals, { added: 6, removed: 4 });
	assert.equal(final.nodes.get("tests/critical/a")?.effectiveEmphasis.origin, "tests/critical");
	assert.equal(final.nodes.get("tests/critical/a")?.effectiveEmphasis.handler?.id, "second");
	assert.equal(b.nodes.get("tests")?.emphasis, undefined);
	assert.equal("emphasis" in (base.nodes.get("tests") ?? {}), false);
	assert.equal(base.nodes.get("destination/moved")?.renameContentChanged, true);
	function rejected(node: AnalysisNode) {
		// @ts-expect-error Source statistics are readonly in analysis.
		node.statistics = { added: 1, removed: 0, binary: false };
		// @ts-expect-error Direct signal arrays cannot be appended.
		node.signals.push({ severity: "notice", message: "x", handler: { id: "bad" } });
		// @ts-expect-error Direct emphasis is changed only through annotation methods.
		node.emphasis = { value: "hidden", reason: "x", handler: { id: "bad" } };
		if (node.statistics) {
			// @ts-expect-error Statistics fields are readonly too.
			node.statistics.added = 10;
		}
		// @ts-expect-error Parent navigation is readonly.
		node.parent = node;
		// @ts-expect-error Children cannot be appended.
		node.children.push(node);
		// @ts-expect-error Source sides cannot be reassigned.
		node.current = { kind: "file", path: "x" };
		if (node.current?.codebase) {
			// @ts-expect-error Handler module descriptors are not authoring facts.
			node.current.codebase.analysisHandlers;
		}
	}
	void rejected;
});
test("empty root finalizes to normal and zero counts", () => {
	const base = createWorkspaceTree({ root: "/workspace", codebases: [], repositories: [] });
	const tree = createAnalysisTree(base, { currentHandler: () => ({ id: "test" }), checkActive: () => {} });
	assert.deepEqual([...tree.root.walk()], [tree.root]);
	const final = finalizeAnalysis(tree).nodes.get(".");
	assert.deepEqual(final?.effectiveEmphasis, { value: "normal" });
	assert.deepEqual(final?.rawTotals, { added: 0, removed: 0 });
});
