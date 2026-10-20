import assert from "node:assert/strict";
import { test } from "node:test";
import { gitEnvironment, line, nulRecords, objectId } from "./git.ts";
import { parseTree } from "./snapshot.ts";

test("Git environment copies explicit inputs and removes every inherited Git override", () => {
	const input = {
		PATH: "/test/bin",
		GIT_DIR: "/other",
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "core.worktree",
		GIT_CONFIG_VALUE_0: "/other",
		GIT_CONFIG_PARAMETERS: "injected",
		GIT_EXEC_PATH: "/other",
	};
	assert.deepEqual(gitEnvironment(input), {
		PATH: "/test/bin",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_ATTR_NOSYSTEM: "1",
		LC_ALL: "C",
	});
	assert.equal(input.GIT_DIR, "/other");
});

test("binary record and line parsing rejects truncation and preserves path newlines", () => {
	assert.deepEqual(nulRecords(Buffer.from("with\ttab\0with\nnewline\0")), ["with\ttab", "with\nnewline"]);
	assert.equal(line(Buffer.from("/directory\n\n")), "/directory\n");
	assert.throws(() => line(Buffer.from("truncated")));
	assert.throws(() => nulRecords(Buffer.from("truncated")));
	assert.throws(() => nulRecords(Buffer.from("one\0\0")));
	assert.throws(() => nulRecords(Buffer.from([0xff, 0])));
	assert.throws(() => objectId(Buffer.from("invalid\n")));
});

test("tree parsing validates blob/gitlink modes and literal path records", () => {
	const oid = "a".repeat(40);
	assert.deepEqual(parseTree(Buffer.from(`100644 blob ${oid}\todd\t\nname\0`)), [
		{ mode: "100644", oid, path: "odd\t\nname" },
	]);
	assert.throws(() => parseTree(Buffer.from(`100644 commit ${oid}\tpath\0`)));
	assert.throws(() => parseTree(Buffer.from(`160000 blob ${oid}\tpath\0`)));
	assert.throws(() => parseTree(Buffer.from(`100644 blob ${oid}\t../outside\0`)));
});
