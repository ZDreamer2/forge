import type { WorkspaceAnalysis, WorkspaceFileDiff } from "@forge/api-contract";
import { type QueryClient, queryOptions, useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { read, readPolicy } from "../../Internal/readPolicy";

const analysisRead = queryOptions({
	...readPolicy,
	queryKey: ["workspace", "analysis"],
	queryFn: ({ signal }) => read<WorkspaceAnalysis>("/api/changes/analysis", signal),
});
const filePrefix = ["workspace", "file"] as const;

function fileKey(path: string, context: 3 | "all") {
	return [...filePrefix, path, context] as const;
}

async function retireComplete(queryClient: QueryClient, path?: string) {
	const filter = {
		queryKey: path === undefined ? filePrefix : [...filePrefix, path],
		predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[3] === "all",
	};
	await queryClient.cancelQueries(filter);
	// Reset instead of remove: the selected reader remains subscribed to this entry.
	await queryClient.resetQueries(filter);
}

function fileRead(queryClient: QueryClient, path: string, context: 3 | "all") {
	return queryOptions({
		...readPolicy,
		queryKey: fileKey(path, context),
		gcTime: 0,
		queryFn: async ({ signal }) => {
			// Every short read starts a new observation, even if that read later fails.
			if (context === 3) await retireComplete(queryClient, path);
			signal.throwIfAborted();
			const search = new URLSearchParams({ path, context: String(context) });
			return read<WorkspaceFileDiff>(`/api/changes/file?${search}`, signal);
		},
	});
}

export function useChangeSetAnalysis() {
	const queryClient = useQueryClient();
	const analysis = useQuery(analysisRead);
	const filesUpdating = useIsFetching({ queryKey: filePrefix, predicate: (query) => query.queryKey[3] === 3 });
	return {
		analysis,
		updating: analysis.isFetching || filesUpdating > 0,
		refresh: async (selectedPath?: string) => {
			await queryClient.cancelQueries({ queryKey: filePrefix });
			await retireComplete(queryClient);
			await Promise.all([
				analysis.refetch({ cancelRefetch: false }),
				queryClient.refetchQueries(
					{
						queryKey: selectedPath === undefined ? filePrefix : fileKey(selectedPath, 3),
						exact: selectedPath !== undefined,
						type: "active",
						predicate: (query) => query.queryKey[3] === 3,
					},
					{ cancelRefetch: false },
				),
			]);
		},
	};
}

export function useSelectedFile(path: string) {
	const queryClient = useQueryClient();
	const file = useQuery({
		...fileRead(queryClient, path, 3),
		refetchOnMount: "always",
		// Observation identity also depends on Query state outside the tracked result fields.
		notifyOnChangeProps: "all",
	});
	const complete = useQuery({ ...fileRead(queryClient, path, "all"), enabled: false });
	return {
		file,
		complete,
		// Query counts accepted responses even when structural sharing preserves identical data.
		observation: queryClient.getQueryState(fileKey(path, 3))?.dataUpdateCount ?? 0,
		reload: () => file.refetch({ cancelRefetch: false }),
		loadComplete: () => {
			// Complete context requires a successful short observation. A failed replacement
			// must recover that short read before expansion can resume.
			const short = queryClient.getQueryCache().find({ queryKey: fileKey(path, 3), exact: true });
			if (!short?.isActive() || short.state.status !== "success" || short.state.fetchStatus === "fetching")
				return Promise.resolve(complete);
			return complete.refetch({ cancelRefetch: false });
		},
	};
}
