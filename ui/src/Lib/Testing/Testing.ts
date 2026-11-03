import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceFileDiff } from "@forge/api-contract";
import type { FileDiffMetadata } from "@pierre/diffs";
import { http } from "msw";

/** Only declared changed paths are served; unexpected requests remain diagnostics. */
export function fileHandler(analysis: WorkspaceAnalysis) {
	return http.get("http://localhost/api/changes/file", ({ request }) => {
		const query = new URL(request.url).searchParams;
		const path = query.get("path");
		const node = path === null ? undefined : analysis.nodes[path];
		if (!node?.kind) throw new Error(`Unexpected file request: ${request.url}`);
		return Response.json(fileObservation(node, analysis, query.get("context") === "all" ? "all" : 3));
	});
}

export function fileObservation(
	node: AnalysisWireNode,
	analysis: WorkspaceAnalysis,
	context: 3 | "all" = 3,
): WorkspaceFileDiff {
	if (!node.kind) throw new Error(`Not a changed entry: ${node.path}`);
	const side = (name: "base" | "current") => {
		const source = node[name];
		return {
			path: source?.path ?? (name === "base" ? (node.from ?? node.path) : node.path),
			kind: source?.kind ?? "file",
			mode: source?.kind === "directory" ? "040000" : source?.kind === "symlink" ? "120000" : "100644",
			present: source?.kind !== "directory" && (name === "base" ? node.kind !== "added" : node.kind !== "deleted"),
			...(source?.codebase === undefined ? {} : { codebase: source.codebase }),
		};
	};
	const common = {
		path: node.path,
		repo: node.repo ?? ".",
		changeKind: node.kind,
		...(node.from === undefined ? {} : { from: node.from }),
		baseline: { kind: "commit" as const, oid: "fixture-baseline" },
		context,
		codebases: analysis.codebases,
		base: side("base"),
		current: side("current"),
		statistics: node.statistics ?? { added: 1, removed: 1, binary: false },
	};
	if (common.statistics.binary) return { ...common, kind: "unsupported", reason: "binary" };
	if (common.statistics.added === 0 && common.statistics.removed === 0) return { ...common, kind: "metadata_only" };
	const removed = common.base.present ? Math.max(common.statistics.removed, 0) : 0;
	const added = common.current.present ? Math.max(common.statistics.added, 0) : 0;
	if (removed === 0 && added === 0) return { ...common, kind: "metadata_only" };
	const deletions = Array.from({ length: removed }, (_, index) => `-old ${node.path} ${index}\n`).join("");
	const additions = Array.from({ length: added }, (_, index) => `+new ${node.path} ${index}\n`).join("");
	return {
		...common,
		kind: "text",
		patch: `diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -${removed ? 1 : 0},${removed} +${added ? 1 : 0},${added} @@\n${deletions}${additions}`,
	};
}

/** Layout and highlighting are exercised by the installed Chromium verifier. */
export function rendererBoundary() {
	return {
		prepareHighlight: async () => {},
		createRenderer: () => ({
			render({ fileDiff, containerWrapper }: { fileDiff: FileDiffMetadata; containerWrapper: HTMLElement }) {
				const content = document.createElement("pre");
				content.setAttribute("aria-label", "Rendered diff text");
				content.textContent = fileDiff.deletionLines.join("") + fileDiff.additionLines.join("");
				containerWrapper.replaceChildren(content);
				return true;
			},
			setOptions() {},
			rerender() {},
			cleanUp() {},
		}),
	};
}
