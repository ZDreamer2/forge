import type { WorkspaceFileDiff } from "@forge/api-contract";
import { type FileDiffMetadata, type Hunk, hydratePartialDiff, parsePatchFiles } from "@pierre/diffs";

export type TextObservation = Extract<WorkspaceFileDiff, { kind: "text" }>;

export class ContextChangedError extends Error {
	constructor() {
		super("The file changed since this diff was loaded. Reload the file before expanding context.");
		this.name = "ContextChangedError";
	}
}

export function parseObservation(observation: TextObservation): FileDiffMetadata {
	const files = parsePatchFiles(observation.patch, undefined, true).flatMap((patch) => patch.files);
	const model = files[0];
	if (files.length !== 1 || model == null || model.hunks.length === 0) {
		throw new Error("Expected one selected file with text hunks");
	}
	for (const hunk of model.hunks) coalesceChanges(hunk);
	restoreLoneCarriageReturn(model, observation.patch);
	// Header quoting is a Git transport detail; the API owns canonical identity.
	model.name = observation.path;
	if (observation.changeKind === "renamed" && observation.from != null) model.prevName = observation.from;
	else delete model.prevName;
	model.mode = observation.current.mode;
	model.prevMode = observation.base.mode;
	model.type =
		observation.changeKind === "added"
			? "new"
			: observation.changeKind === "deleted"
				? "deleted"
				: observation.changeKind === "renamed"
					? "rename-changed"
					: "change";
	// Added/deleted patches already represent the whole existing side.
	if (model.type === "new" || model.type === "deleted") model.isPartial = false;
	return model;
}

export function hasOmittedContext(model: FileDiffMetadata): boolean {
	// A short patch does not reveal whether unchanged trailing lines exist.
	return model.isPartial && (model.type === "change" || model.type === "rename-changed");
}

export function hydrateObservation(
	short: TextObservation,
	shortModel: FileDiffMetadata,
	complete: WorkspaceFileDiff,
): FileDiffMetadata {
	if (complete.kind !== "text" || complete.context !== "all" || !sameIdentity(short, complete)) {
		throw new ContextChangedError();
	}
	const fullModel = parseObservation(complete);
	assertComplete(fullModel);
	if (JSON.stringify(changedBlocks(shortModel)) !== JSON.stringify(changedBlocks(fullModel))) {
		throw new ContextChangedError();
	}
	for (const hunk of shortModel.hunks) {
		for (const side of ["deletion", "addition"] as const) {
			const start = sideStart(hunk[`${side}Start`], hunk[`${side}Count`]);
			const represented = shortModel[`${side}Lines`].slice(
				hunk[`${side}LineIndex`],
				hunk[`${side}LineIndex`] + hunk[`${side}Count`],
			);
			if (represented.some((line, offset) => fullModel[`${side}Lines`][start + offset] !== line)) {
				throw new ContextChangedError();
			}
		}
	}
	return hydratePartialDiff("clone", shortModel, {
		oldFile: { name: short.base.path, contents: fullModel.deletionLines.join("") },
		newFile: { name: short.current.path, contents: fullModel.additionLines.join("") },
	});
}

function sameIdentity(left: TextObservation, right: TextObservation): boolean {
	return (
		left.path === right.path &&
		left.repo === right.repo &&
		left.changeKind === right.changeKind &&
		left.from === right.from &&
		JSON.stringify(left.baseline) === JSON.stringify(right.baseline) &&
		(["base", "current"] as const).every((side) => {
			const a = left[side];
			const b = right[side];
			return (
				a.path === b.path &&
				a.kind === b.kind &&
				a.mode === b.mode &&
				a.present === b.present &&
				a.codebase === b.codebase
			);
		})
	);
}

function sideStart(start: number, count: number): number {
	return start - (count === 0 ? 0 : 1);
}

function assertComplete(model: FileDiffMetadata): void {
	let oldEnd = 0;
	let newEnd = 0;
	for (const hunk of model.hunks) {
		if (
			sideStart(hunk.deletionStart, hunk.deletionCount) !== oldEnd ||
			sideStart(hunk.additionStart, hunk.additionCount) !== newEnd
		) {
			throw new ContextChangedError();
		}
		oldEnd += hunk.deletionCount;
		newEnd += hunk.additionCount;
	}
	if (oldEnd !== model.deletionLines.length || newEnd !== model.additionLines.length) throw new ContextChangedError();
}

function changedBlocks(model: FileDiffMetadata) {
	return model.hunks.flatMap((hunk) => {
		let oldLine = sideStart(hunk.deletionStart, hunk.deletionCount);
		let newLine = sideStart(hunk.additionStart, hunk.additionCount);
		const blocks = [];
		for (const content of hunk.hunkContent) {
			if (content.type === "context") {
				oldLine += content.lines;
				newLine += content.lines;
			} else {
				blocks.push({
					oldLine,
					newLine,
					deleted: model.deletionLines.slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions),
					added: model.additionLines.slice(content.additionLineIndex, content.additionLineIndex + content.additions),
				});
				oldLine += content.deletions;
				newLine += content.additions;
			}
		}
		return blocks;
	});
}

function coalesceChanges(hunk: Hunk): void {
	const normalized: Hunk["hunkContent"] = [];
	for (const content of hunk.hunkContent) {
		const previous = normalized.at(-1);
		// 1.6.2 always subdivides replacements for similarity pairing. Restore
		// Git's contiguous block without crossing context or changing its arrays.
		if (previous?.type === "change" && content.type === "change") {
			if (
				previous.deletionLineIndex + previous.deletions !== content.deletionLineIndex ||
				previous.additionLineIndex + previous.additions !== content.additionLineIndex
			) {
				throw new Error("Noncontiguous Pierre change groups");
			}
			previous.deletions += content.deletions;
			previous.additions += content.additions;
		} else normalized.push({ ...content });
	}
	hunk.hunkContent = normalized;
}

function restoreLoneCarriageReturn(model: FileDiffMetadata, patch: string): void {
	// The released parser removes CR along with the synthetic LF before an EOF
	// marker. Only repair that exact raw-patch edge; preserve ordinary CRLF.
	for (const match of patch.matchAll(/^([ +-])(.*\r)\n\\ No newline at end of file(?:\n|$)/gm)) {
		const rawPayload = match[2];
		if (rawPayload == null) continue;
		const sides =
			match[1] === " "
				? (["deletion", "addition"] as const)
				: match[1] === "-"
					? (["deletion"] as const)
					: (["addition"] as const);
		for (const side of sides) {
			const lines = model[`${side}Lines`];
			const last = lines.length - 1;
			if (lines[last] === rawPayload.slice(0, -1)) {
				lines[last] = rawPayload;
				model[`${side}CharacterCount`]++;
			}
		}
	}
}
