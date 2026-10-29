import type { AnalysisHandler } from "./types.ts";
export const deemphasizeDirectories: AnalysisHandler = (root) => {
	for (const node of root.walk()) {
		if (node.base?.kind !== "directory" && node.current?.kind !== "directory") continue;
		const name = node.path.slice(node.path.lastIndexOf("/") + 1);
		if (node.path === "plans") node.deemphasize("Workspace planning documents");
		else if (name === "tests" || name === "Tests") node.deemphasize("Test directory");
	}
};
export const warnLargeMarkdown: AnalysisHandler = async (root) => {
	const candidates = [...root.walk()].filter(
		(node) =>
			node.current?.kind === "file" &&
			(node.kind === "added" ||
				node.kind === "modified" ||
				(node.kind === "renamed" && node.renameContentChanged === true)) &&
			/\.(?:md|markdown)$/i.test(node.path) &&
			!node.path.startsWith("plans/"),
	);
	let next = 0;
	async function readCandidates() {
		while (next < candidates.length) {
			root.signal.throwIfAborted();
			const node = candidates[next++];
			if (!node) return;
			const size = await root.source.currentByteSize(node);
			root.signal.throwIfAborted();
			if (size > 20_480) node.warn("Markdown file exceeds 20 KiB");
		}
	}
	await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, () => readCandidates()));
};
