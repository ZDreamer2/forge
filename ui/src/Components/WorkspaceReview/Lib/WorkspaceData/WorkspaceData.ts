import type { WorkspaceIdentity } from "@forge/api-contract";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { read, readPolicy } from "../../Internal/readPolicy";

const workspaceRead = queryOptions({
	...readPolicy,
	queryKey: ["workspace"],
	queryFn: ({ signal }) => read<WorkspaceIdentity>("/api/workspace", signal),
});

export function useWorkspaceIdentity() {
	const workspace = useQuery(workspaceRead);
	return {
		workspace,
		updating: workspace.isFetching,
		refresh: () => workspace.refetch({ cancelRefetch: false }),
	};
}
