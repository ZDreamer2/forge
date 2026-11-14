import { Hono } from "hono";
import type { ServerHubSelection } from "../../api-contract/index.ts";
import type { SelectedHubSnapshot } from "../../server-hub/index.ts";
import { apiError } from "./wire.ts";

export type SelectedHubRouteDeps = {
	inspectSelectedHub: () => SelectedHubSnapshot;
};

export function createSelectedHubRoutes({ inspectSelectedHub }: SelectedHubRouteDeps) {
	const routes = new Hono();
	routes.get("/server-hub/selection", (context) => {
		if (new URL(context.req.url).searchParams.size !== 0) return context.json(apiError("invalid_request"), 400);
		const snapshot = inspectSelectedHub();
		const result: ServerHubSelection = {
			source: { status: snapshot.source.status, url: snapshot.source.url },
			servers:
				snapshot.servers?.map(({ id, name, url, availability }) => ({
					id,
					name,
					url,
					availability: {
						status: availability.status,
						checkedAt: availability.checkedAt,
						lastReachableAt: availability.lastReachableAt,
						error: availability.error,
						stale: availability.stale,
					},
				})) ?? null,
			lastSuccessAt: snapshot.lastSuccessAt,
			error: snapshot.error,
			stale: snapshot.stale,
		};
		return context.json(result);
	});
	routes.all("/server-hub/selection", (context) => {
		context.header("Allow", "GET, HEAD");
		return context.json(apiError("method_not_allowed"), 405);
	});
	return routes;
}
