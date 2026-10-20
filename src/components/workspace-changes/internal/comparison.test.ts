import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNumstat, parseRaw } from "./comparison.ts";

const oldOid = "1".repeat(40);
const newOid = "2".repeat(40);
const rename = `:100644 100644 ${oldOid} ${newOid} R096\0old\tname\0new\nname\0`;

test("raw parsing retains literal rename paths and zero-padded Git similarity scores", () => {
	assert.deepEqual(parseRaw(Buffer.from(rename)), [
		{
			oldMode: "100644",
			newMode: "100644",
			oldOid,
			newOid,
			status: "R",
			oldPath: "old\tname",
			newPath: "new\nname",
		},
	]);
	assert.equal(parseRaw(Buffer.from(rename.replace("R096", "C100")))[0]?.status, "C");
});

test("raw parsing rejects truncated, invalid and undecodable records", () => {
	for (const value of [
		rename.slice(0, -1),
		rename.replace("R096", "R101"),
		rename.replace("R096", "U"),
		`:100644 100644 ${oldOid} ${newOid} R096\0old\0`,
		rename.replace("old\tname", "../outside"),
	]) {
		assert.throws(() => parseRaw(Buffer.from(value)));
	}
	assert.throws(() =>
		parseRaw(Buffer.concat([Buffer.from(`:100644 100644 ${oldOid} ${newOid} M\0`), Buffer.from([0xff, 0])])),
	);
});

test("numstat parsing handles rename record separators, binary counts and literal paths", () => {
	const result = parseNumstat(Buffer.from("1\t2\t\0old\tname\0new\nname\0-\t-\tbinary\0"));
	assert.deepEqual(result.get("old\tname\0new\nname"), { added: 1, removed: 2 });
	assert.deepEqual(result.get("binary\0binary"), { added: null, removed: null });
	assert.equal(parseNumstat(Buffer.alloc(0)).size, 0);
});

test("numstat parsing rejects incomplete records and invalid or excessive counts", () => {
	for (const value of [
		"0\t0\tpath",
		"0\t0\t\0old\0",
		"-\t0\tpath\0",
		"-1\t0\tpath\0",
		"9007199254740992\t0\tpath\0",
		"1\t2\tpath\0\0",
		"1\t2\tpath\0".repeat(2),
	]) {
		assert.throws(() => parseNumstat(Buffer.from(value)));
	}
});
