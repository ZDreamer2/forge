import { useEffect, useRef, useState } from "react";
import type { TreeProjection } from "./treeProjection";

export function useExpansion(projection: TreeProjection, selectedPath: string | undefined) {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const knownBranches = useRef(new Set<string>());
	const revealedSelection = useRef({ path: selectedPath, resolved: false });

	useEffect(() => {
		const previous = knownBranches.current;
		knownBranches.current = projection.branches;
		setExpanded(
			(current) =>
				new Set([
					...[...current].filter((path) => projection.branches.has(path)),
					...[...projection.branches].filter((path) => !previous.has(path)),
				]),
		);
	}, [projection.branches]);

	useEffect(() => {
		if (revealedSelection.current.path !== selectedPath) {
			revealedSelection.current = { path: selectedPath, resolved: false };
		}
		if (selectedPath === undefined || revealedSelection.current.resolved || !projection.nodes.has(selectedPath)) return;
		// An address is revealed only on navigation or first resolution. Reparenting
		// its repository placeholder on Refresh must not reopen a collapsed ancestor.
		revealedSelection.current.resolved = true;
		const ancestors = new Set<string>();
		let path = selectedPath;
		for (;;) {
			const parent = [...projection.nodes.values()].find((entry) => entry.children.includes(path));
			if (!parent || ancestors.has(parent.path)) break;
			ancestors.add(parent.path);
			path = parent.path;
		}
		setExpanded((current) => new Set([...current, ...ancestors]));
	}, [selectedPath, projection.nodes]);

	return {
		expanded,
		toggle(path: string) {
			setExpanded((current) => {
				const next = new Set(current);
				if (!next.delete(path)) next.add(path);
				return next;
			});
		},
		expandAll: () => setExpanded(new Set(projection.branches)),
		collapseAll: () => setExpanded(new Set()),
	};
}
