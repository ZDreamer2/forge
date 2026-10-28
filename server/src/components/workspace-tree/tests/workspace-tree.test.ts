import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceTree } from "../index.ts";

function tree() {
	return createWorkspaceTree({
		root: "/workspace",
		repositories: [{ path: "." }, { path: "nested" }],
		codebases: [
			{ root: "/workspace/app", guide: "/guides/app" },
			{ root: "/workspace/app/deep", guide: "/guides/deep", type: { id: "service", guide: "/types/service" } },
			{ root: "/workspace/nested", guide: "/guides/nested" },
		],
	});
}

test("resolves present-side owners lexically with closest roots independently of repository identity", () => {
	const value = tree();
	const moved = value.insert({
		repo: ".",
		path: "app/deep/new.ts",
		kind: "renamed",
		from: "app/old.ts",
		base: { kind: "file" },
		current: { kind: "file" },
		statistics: { added: 2, removed: 1, binary: false },
	});
	assert.equal(moved.base?.codebase?.root, "/workspace/app");
	assert.equal(moved.current?.codebase?.root, "/workspace/app/deep");
	assert.equal(moved.base?.repository, ".");
	assert.equal(moved.current?.repository, ".");
	const deleted = value.insert({
		repo: "nested",
		path: "nested/deleted.ts",
		kind: "deleted",
		base: { kind: "symlink" },
		statistics: { added: 0, removed: 1, binary: false },
	});
	assert.equal(deleted.base?.repository, "nested");
	assert.equal(deleted.base?.codebase?.root, "/workspace/nested");
	assert.equal(deleted.current, undefined);
	const unmatched = value.insert({
		repo: ".",
		path: "other.txt",
		kind: "added",
		current: { kind: "file" },
		statistics: { added: 1, removed: 0, binary: false },
	});
	assert.equal(unmatched.base, undefined);
	assert.equal(unmatched.current?.codebase, undefined);
	assert.equal(value.nodes.get("app/deep")?.current?.codebaseRoot?.root, "/workspace/app/deep");
	assert.equal(value.nodes.get("nested")?.base?.repositoryRoot, "nested");
	assert.equal(value.nodes.get(".")?.current?.repositoryRoot, ".");
});

test("counts each rename once at its destination, retains former ancestry with zero totals and ignores binary counts", () => {
	const value = tree();
	value.insert({
		repo: ".",
		path: "new/place/file",
		from: "former/place/file",
		kind: "renamed",
		base: { kind: "file" },
		current: { kind: "file" },
		statistics: { added: 4, removed: 2, binary: false },
	});
	value.insert({
		repo: ".",
		path: "new/binary",
		kind: "modified",
		base: { kind: "file" },
		current: { kind: "file" },
		statistics: { added: 0, removed: 0, binary: true },
	});
	value.insert({
		repo: ".",
		path: "former/deleted",
		kind: "deleted",
		base: { kind: "file" },
		statistics: { added: 0, removed: 3, binary: false },
	});
	assert.deepEqual(value.totals(), { added: 4, removed: 5 });
	assert.deepEqual(value.totals("new"), { added: 4, removed: 2 });
	assert.deepEqual(value.totals("former/place"), { added: 0, removed: 0 });
	assert.deepEqual(value.totals("former"), { added: 0, removed: 3 });
	assert.deepEqual(value.totals("new/place/file"), { added: 4, removed: 2 });
	assert.equal(value.nodes.has("former/place/file"), false);
	assert.equal(value.nodes.get("former/place")?.base?.kind, "directory");
	assert.equal(value.nodes.get("former/place")?.current, undefined);
	assert.equal(value.entries.length, 3);
	const first = value.entries[0];
	assert.ok(first);
	first.statistics = { added: 6, removed: 2, binary: false };
	assert.deepEqual(value.totals(), { added: 6, removed: 5 });
});

test("supports unchanged nodes and file, directory and symlink transitions regardless of insertion order", () => {
	for (const reverse of [false, true]) {
		const value = tree();
		const entries = [
			{
				repo: ".",
				path: "app/old-dir",
				kind: "modified" as const,
				base: { kind: "directory" as const },
				current: { kind: "file" as const },
			},
			{ repo: ".", path: "app/old-dir/deleted", kind: "deleted" as const, base: { kind: "file" as const } },
		];
		for (const entry of reverse ? entries.reverse() : entries) value.insert(entry);
		assert.equal(value.nodes.get("app/old-dir")?.base?.kind, "directory");
		assert.equal(value.nodes.get("app/old-dir")?.current?.kind, "file");
		value.insert({
			repo: ".",
			path: "app/link",
			kind: "modified",
			base: { kind: "file" },
			current: { kind: "symlink" },
		});
		value.insert({ repo: ".", path: "app/unchanged", base: { kind: "file" }, current: { kind: "file" } });
		assert.equal(value.nodes.get("app/unchanged")?.kind, undefined);
		assert.equal(value.nodes.get("app/link")?.current?.kind, "symlink");
		assert.deepEqual(value.totals(), { added: 0, removed: 0 });
	}
});

test("structural views stay live during incremental insertion while only statistics are writable", () => {
	const value = tree();
	const nodes = value.nodes;
	const entries = value.entries;
	const entry = value.insert({ repo: ".", path: "app/file", current: { kind: "file" } });
	value.insert({ repo: ".", path: "app/second", current: { kind: "file" } });
	assert.equal(entries.length, 2);
	assert.equal(nodes.get("app/file"), entry);
	assert.equal(entries[0], entry);
	entry.statistics = { added: 3, removed: 0, binary: false };
	assert.deepEqual(value.totals("app"), { added: 3, removed: 0 });

	// Compile-only negative controls: structural edits must go through the tree's operations.
	function rejectedMutations() {
		// @ts-expect-error Consumers cannot insert into the node map.
		nodes.set("other", entry);
		// @ts-expect-error Consumers cannot remove nodes independently of entries.
		nodes.delete(entry.path);
		// @ts-expect-error Consumers cannot clear the node map.
		nodes.clear();
		// @ts-expect-error Consumers cannot append entries independently of nodes.
		entries.push(entry);
		// @ts-expect-error Consumers cannot remove entries independently of nodes.
		entries.pop();
		// @ts-expect-error Entry paths are tree-owned identity.
		entry.path = "other";
		// @ts-expect-error Repository identity is tree-owned.
		entry.repo = "nested";
		// @ts-expect-error Change kind is structural data.
		entry.kind = "deleted";
		// @ts-expect-error Rename source is structural data.
		entry.from = "former";
		// @ts-expect-error Side existence is tree-owned.
		entry.base = { path: entry.path, kind: "file" };
		// @ts-expect-error Side ownership is tree-owned.
		entry.current = { path: entry.path, kind: "file" };
		const lookedUp = nodes.get(entry.path);
		if (lookedUp) {
			// @ts-expect-error Map lookups expose the same protected structural vocabulary.
			lookedUp.current = undefined;
		}
		if (entry.current) {
			// @ts-expect-error Side kinds cannot bypass structural operations either.
			entry.current.kind = "directory";
		}
	}
	void rejectedMutations;
});

test("rejects duplicate or malformed insertions while preserving literal POSIX names", () => {
	const value = tree();
	for (const path of ["", "/absolute", "../escape", "a//b", "a/./b", "a\0b"]) {
		assert.throws(() => value.insert({ repo: ".", path, current: { kind: "file" } }), /normalized/);
	}
	value.insert({ repo: ".", path: "__proto__/a\n<b>\\c", current: { kind: "file" } });
	assert.equal(value.nodes.get("__proto__/a\n<b>\\c")?.current?.kind, "file");
	assert.throws(() => value.insert({ repo: ".", path: "__proto__/a\n<b>\\c", current: { kind: "file" } }), /Duplicate/);
	assert.throws(() => value.insert({ repo: ".", path: "absent" }), /present side/);
	assert.throws(
		() => value.insert({ repo: ".", path: "bad-rename", kind: "renamed", current: { kind: "file" } }),
		/previous path/,
	);
});
