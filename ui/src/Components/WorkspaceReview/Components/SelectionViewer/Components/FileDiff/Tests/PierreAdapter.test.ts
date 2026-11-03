import { describe, expect, it } from "vitest";
import {
	ContextChangedError,
	hasOmittedContext,
	hydrateObservation,
	parseObservation,
	type TextObservation,
} from "../Internal/pierreAdapter";

describe("Pierre selected-file adaptation", () => {
	it("restores a Git replacement subdivided by released similarity pairing", () => {
		const observation = text(
			"@@ -1,2 +1,3 @@\n-const first = 1;\n-const second = 2;\n+unrelated preamble\n+const first = 10;\n+const second = 20;\n",
		);
		const model = parseObservation(observation);
		expect(model.hunks[0]?.hunkContent).toEqual([
			{ type: "change", deletions: 2, additions: 3, deletionLineIndex: 0, additionLineIndex: 0 },
		]);
		expect(model.deletionLines).toEqual(["const first = 1;\n", "const second = 2;\n"]);
		expect(model.additionLines).toEqual(["unrelated preamble\n", "const first = 10;\n", "const second = 20;\n"]);
		expect(model.hunks[0]?.splitLineCount).toBe(3);
		expect(model.hunks[0]?.unifiedLineCount).toBe(5);
	});

	it("hydrates merged complete context while retaining short hunk boundaries and every gap", () => {
		const { short, complete } = twoHunks();
		const model = parseObservation(short);
		const hydrated = hydrateObservation(short, model, complete);
		expect(hydrated).not.toBe(model);
		expect(model.isPartial).toBe(true);
		expect(model.additionLines).toHaveLength(14);
		expect(hydrated.isPartial).toBe(false);
		expect(hydrated.hunks).toHaveLength(2);
		expect(hydrated.hunks.map((hunk) => hunk.collapsedBefore)).toEqual([4, 9]);
		expect(hydrated.additionLines).toHaveLength(30);
		expect(hydrated.hunks[1]?.additionLineIndex).toBe(20);
		expect(hydrated.splitLineCount).toBe(30);
		expect(hydrated.hunks.at(-1)?.additionStart).toBe(21);
		expect(hydrated.additionLines.slice(27)).toEqual(["line 28\n", "line 29\n", "line 30\n"]);
	});

	it("rejects changed context or payload despite unchanged identity and totals, then permits a new short observation", () => {
		const { short, complete } = twoHunks();
		const model = parseObservation(short);
		for (const replacement of [
			complete.patch.replace(" line 5\n", " different\n"),
			complete.patch.replace("+changed 8\n", "+changed X\n"),
		]) {
			expect(() => hydrateObservation(short, model, { ...complete, patch: replacement })).toThrow(ContextChangedError);
			expect(model.isPartial).toBe(true);
			expect(model.additionLines).toContain("changed 8\n");
		}
		const nextShort = { ...short, patch: short.patch.replace("+changed 8\n", "+changed X\n") };
		const nextComplete = { ...complete, patch: complete.patch.replace("+changed 8\n", "+changed X\n") };
		expect(hydrateObservation(nextShort, parseObservation(nextShort), nextComplete).additionLines).toContain(
			"changed X\n",
		);
	});

	it("accepts changes solely in omitted unchanged text without claiming a snapshot", () => {
		const { short, complete } = twoHunks();
		const expanded = { ...complete, patch: complete.patch.replace(" line 1\n", " new omitted context\n") };
		expect(hydrateObservation(short, parseObservation(short), expanded).additionLines[0]).toBe("new omitted context\n");
	});

	it("rejects side, mode, baseline, disappearance and refused complete observations", () => {
		const { short, complete } = twoHunks();
		const model = parseObservation(short);
		const changed = [
			{ ...complete, baseline: { kind: "unborn" as const } },
			{ ...complete, current: { ...complete.current, mode: "100755" } },
			{ ...complete, current: { ...complete.current, kind: "symlink" as const } },
			{ ...complete, base: { ...complete.base, present: false } },
			{ ...complete, current: { ...complete.current, codebase: "other" } },
			{ kind: "not_changed" as const, codebases: {} },
			{ ...complete, kind: "unsupported" as const, reason: "too_large" as const },
		];
		for (const result of changed) expect(() => hydrateObservation(short, model, result)).toThrow(ContextChangedError);
		expect(model.isPartial).toBe(true);
	});

	it("uses canonical Unicode and control-character rename identity rather than quoted headers", () => {
		const observation = text("@@ -1 +1 @@\n-old\n+new\n", {
			path: '新\tname\n"\\.ts',
			from: "old folder/old.ts",
			changeKind: "renamed",
		});
		observation.patch = observation.patch.replace(
			"diff --git a/file.ts b/file.ts",
			'diff --git "a/old folder/old.ts" "b/\\346\\226\\260\\tname\\n\\"\\\\.ts"',
		);
		const model = parseObservation(observation);
		expect(model.name).toBe(observation.path);
		expect(model.prevName).toBe(observation.from);
		expect(model.type).toBe("rename-changed");
		expect(hasOmittedContext(model)).toBe(true);
	});

	it.each([
		["CRLF", "old\r\n", "new\r\n"],
		["BOM", "\uFEFFold\n", "\uFEFFnew\n"],
		["no final LF", "old", "new"],
		["lone CR", "old\r", "new\r"],
		["CR on old side", "old\r", "new\n"],
		["CR on new side", "old\n", "new\r"],
	])("preserves %s payload and EOF through real parse and hydration", (_label, oldText, newText) => {
		const observation = text(`@@ -1 +1 @@\n${payload("-", oldText)}${payload("+", newText)}`);
		const model = parseObservation(observation);
		expect(model.deletionLines.join("")).toBe(oldText);
		expect(model.additionLines.join("")).toBe(newText);
		expect(model.deletionCharacterCount).toBe(oldText.length);
		expect(model.additionCharacterCount).toBe(newText.length);
		const hydrated = hydrateObservation(observation, model, { ...observation, context: "all" });
		expect(hydrated.deletionLines.join("")).toBe(oldText);
		expect(hydrated.additionLines.join("")).toBe(newText);
	});

	it("repairs a lone CR in an EOF context line on both sides", () => {
		const observation = text("@@ -1,2 +1,2 @@\n-old\n+new\n same\r\n\\ No newline at end of file\n");
		const model = parseObservation(observation);
		expect(model.additionLines).toEqual(["new\n", "same\r"]);
		expect(model.deletionLines).toEqual(["old\n", "same\r"]);
	});

	it("keeps additions/deletions complete and distinguishes empty existing sides from absent sides", () => {
		const added = text("@@ -0,0 +1 @@\n+new\n", { changeKind: "added" });
		added.base = { ...added.base, present: false, mode: "000000" };
		const addedModel = parseObservation(added);
		expect(addedModel.type).toBe("new");
		expect(addedModel.deletionLines).toEqual([]);
		expect(hasOmittedContext(addedModel)).toBe(false);
		const emptyBase = text("@@ -0,0 +1 @@\n+new\n");
		const emptyModel = parseObservation(emptyBase);
		expect(emptyModel.type).toBe("change");
		expect(hydrateObservation(emptyBase, emptyModel, { ...emptyBase, context: "all" }).deletionLines).toEqual([]);
		const deleted = text("@@ -1 +0,0 @@\n-old\n", { changeKind: "deleted" });
		deleted.current = { ...deleted.current, present: false, mode: "000000" };
		const deletedModel = parseObservation(deleted);
		expect(deletedModel.type).toBe("deleted");
		expect(deletedModel.additionLines).toEqual([]);
		expect(hasOmittedContext(deletedModel)).toBe(false);
	});

	it("rejects malformed and multi-file text rather than silently rendering partial parser output", () => {
		expect(() => parseObservation(text("@@ -1 +1 @@\n-old\n"))).toThrow();
		const valid = text("@@ -1 +1 @@\n-old\n+new\n");
		expect(() => parseObservation({ ...valid, patch: valid.patch + valid.patch })).toThrow("one selected file");
	});
});

function text(body: string, overrides: Partial<TextObservation> = {}): TextObservation {
	return {
		kind: "text",
		path: "file.ts",
		repo: ".",
		changeKind: "modified",
		context: 3,
		baseline: { kind: "commit", oid: "abc123" },
		codebases: {},
		base: { path: "file.ts", kind: "file", mode: "100644", present: true },
		current: { path: "file.ts", kind: "file", mode: "100644", present: true },
		statistics: { added: 2, removed: 2, binary: false },
		patch: `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n${body}`,
		...overrides,
	};
}

function payload(prefix: string, contents: string): string {
	return `${prefix}${contents}${contents.endsWith("\n") ? "" : "\n\\ No newline at end of file\n"}`;
}

function twoHunks() {
	const lines = (from: number, to: number) =>
		Array.from({ length: to - from + 1 }, (_, index) => {
			const line = from + index;
			return line === 8 || line === 24 ? `-line ${line}\n+changed ${line}\n` : ` line ${line}\n`;
		}).join("");
	return {
		short: text(`@@ -5,7 +5,7 @@\n${lines(5, 11)}@@ -21,7 +21,7 @@\n${lines(21, 27)}`),
		complete: text(`@@ -1,30 +1,30 @@\n${lines(1, 30)}`, { context: "all" }),
	};
}
