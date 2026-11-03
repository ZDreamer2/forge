export const readPolicy = {
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

export async function read<T>(path: string, signal: AbortSignal): Promise<T> {
	const response = await fetch(new URL(path, window.location.href), { signal });
	if (!response.ok) throw new Error(`Request failed (${response.status})`);
	return response.json();
}
