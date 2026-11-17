import type { ServerHubSelection } from "@forge/api-contract";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { read, readPolicy } from "../../../../Internal/readPolicy";

function selectionOptions() {
	return queryOptions({
		queryKey: ["server-hub-selection"],
		queryFn: ({ signal }) => read<ServerHubSelection>("/api/server-hub/selection", signal),
		...readPolicy,
	});
}

export function useServerHubSelection() {
	return useQuery(selectionOptions());
}
