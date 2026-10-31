import type { WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { queryOptions, useQuery } from "@tanstack/react-query";

const readPolicy = {
	// Public-network connectivity does not determine whether the loopback server is reachable.
	networkMode: "always",
	staleTime: Number.POSITIVE_INFINITY,
	retry: false,
	retryOnMount: false,
	refetchOnMount: false,
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
	refetchInterval: false,
} as const;

const workspaceRead = queryOptions({
	...readPolicy,
	queryKey: ["workspace"],
	queryFn: ({ signal }) => read<WorkspaceIdentity>("/api/workspace", signal),
});
const analysisRead = queryOptions({
	...readPolicy,
	queryKey: ["workspace", "analysis"],
	queryFn: ({ signal }) => read<WorkspaceAnalysis>("/api/changes/analysis", signal),
});

export function useWorkspaceOverview() {
	const workspace = useQuery(workspaceRead);
	const analysis = useQuery(analysisRead);
	const updating = workspace.isFetching || analysis.isFetching;

	return {
		workspace,
		analysis,
		updating,
		refresh: () =>
			Promise.all([workspace.refetch({ cancelRefetch: false }), analysis.refetch({ cancelRefetch: false })]),
	};
}

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
	const response = await fetch(new URL(path, window.location.href), { signal });
	if (!response.ok) throw new Error(`Request failed (${response.status})`);
	return response.json();
}
