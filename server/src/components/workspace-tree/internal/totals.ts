import type { LineTotals, TreeNode } from "./types.ts";

export function lineTotals(entries: readonly TreeNode[], path: string): LineTotals {
	let added = 0;
	let removed = 0;
	for (const entry of entries) {
		if (entry.path !== path && path !== "." && !entry.path.startsWith(`${path}/`)) continue;
		if (!entry.statistics || entry.statistics.binary) continue;
		added += entry.statistics.added;
		removed += entry.statistics.removed;
	}
	return { added, removed };
}
