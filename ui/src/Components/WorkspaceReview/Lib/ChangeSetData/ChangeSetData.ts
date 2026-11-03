import type { WorkspaceAnalysis } from "@forge/api-contract";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { read, readPolicy } from "../../Internal/readPolicy";

const analysisRead = queryOptions({
	...readPolicy,
	queryKey: ["workspace", "analysis"],
	queryFn: ({ signal }) => read<WorkspaceAnalysis>("/api/changes/analysis", signal),
});

export function useChangeSetAnalysis() {
	const analysis = useQuery(analysisRead);
	return {
		analysis,
		updating: analysis.isFetching,
		refresh: () => analysis.refetch({ cancelRefetch: false }),
	};
}
