import assert from "node:assert/strict";
import { test } from "node:test";
import { parseComparison } from "../internal/comparison-records.ts";
import type { CollectedChange, ComparedChange } from "../internal/types.ts";

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

test("collected descriptors require a resolved baseline and explicit comparison context", () => {
	const raw: ComparedChange = {
		path: "file",
		kind: "modified",
		oldMode: "100644",
		newMode: "100644",
		statistics: { added: 1, removed: 1, binary: false },
	};
	const collected: CollectedChange = {
		...raw,
		baseline: { kind: "unborn", oid: "resolved-empty-tree" },
		comparison: { kind: "scratch-index", entries: [] },
	};
	assert.equal(collected.baseline.oid, "resolved-empty-tree");

	function rejectedDescriptors() {
		// @ts-expect-error Raw facts are not ready for file acquisition.
		const unfinished: CollectedChange = raw;
		// @ts-expect-error Unborn baselines still need their resolved comparison object.
		void ({ ...collected, baseline: { kind: "unborn" } } satisfies CollectedChange);
		// @ts-expect-error Scratch context explicitly carries its entries, including an empty list.
		void ({ ...collected, comparison: { kind: "scratch-index" } } satisfies CollectedChange);
		// @ts-expect-error Index selection is never implicit on a finalized descriptor.
		void ({ ...collected, comparison: undefined } satisfies CollectedChange);
		void unfinished;
	}
	void rejectedDescriptors;
});
