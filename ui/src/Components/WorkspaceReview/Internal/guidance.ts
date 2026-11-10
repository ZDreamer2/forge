export type { GuidanceEntry, WorkspaceAnalysis, WorkspaceGuidance } from "@forge/api-contract";

export function isWorkspaceGuidanceRoot(root: string): boolean {
	return (
		root === "." ||
		(!!root &&
			!root.includes("\0") &&
			!root.startsWith("\\\\") &&
			!/^[A-Za-z]:[\\/]/.test(root) &&
			root.split("/").every((part) => !!part && part !== "." && part !== ".."))
	);
}
