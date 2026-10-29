import assert from "node:assert/strict";
import { test } from "node:test";
import { parseComparison } from "../internal/comparison-records.ts";

const oldId = "1".repeat(40);
const newId = "2".repeat(40);
function rename(old: string, current: string, counts = "0\t0", modes = "100644 100644") {
	return Buffer.from(`:${modes} ${old} ${current} R100\0old.md\0new.md\0${counts}\t\0old.md\0new.md\0`);
}

test("rename content identity comes from raw blobs, including R100 and binary markers", () => {
	for (const counts of ["0\t0", "1\t1", "-\t-"]) {
		assert.equal(parseComparison(rename(oldId, oldId, counts))[0]?.renameContentChanged, false);
		assert.equal(parseComparison(rename(oldId, newId, counts))[0]?.renameContentChanged, true);
	}
	assert.equal(parseComparison(rename(oldId, oldId, "0\t0", "100644 100755"))[0]?.renameContentChanged, false);
});

test("rename rejects absent, malformed, mismatched and zero blob identities", () => {
	for (const id of ["", "x".repeat(40), "1".repeat(39), "0".repeat(40), "1".repeat(64)]) {
		assert.throws(() => parseComparison(rename(oldId, id)));
		assert.throws(() => parseComparison(rename(id, oldId)));
	}
});

test("gitlink normalization removes rename-only facts", () => {
	for (const modes of ["160000 100644", "100644 160000"]) {
		const [change] = parseComparison(rename(oldId, newId, "1\t1", modes));
		assert.equal(change?.from, undefined);
		assert.equal(change?.renameContentChanged, undefined);
		assert.equal(change?.kind, modes.startsWith("160000") ? "added" : "deleted");
	}
});
