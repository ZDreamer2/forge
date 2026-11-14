import { Hono } from "hono";
import type { ServerHubServers } from "../../api-contract/index.ts";
import type { ServerHubSnapshot } from "../../server-hub/index.ts";
import { apiError } from "./wire.ts";

export type ServerHubRouteDeps = {
	inspectServerHub: () => ServerHubSnapshot | null;
};

export function createServerHubRoutes({ inspectServerHub }: ServerHubRouteDeps) {
	const routes = new Hono();
	routes.get("/server-hub/servers", (context) => {
		if (new URL(context.req.url).searchParams.size !== 0) return context.json(apiError("invalid_request"), 400);
		const snapshot = inspectServerHub();
		if (snapshot === null) {
			return context.json(
				{
					error: {
						code: "internal_error",
						message: "Server hub registrations are unavailable; repair configuration and reload",
					},
				},
				503,
			);
		}
		const result: ServerHubServers = {
			servers: snapshot.servers.map(({ id, name, url, availability }) => ({
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
			})),
		};
		return context.json(result);
	});
	routes.all("/server-hub/servers", (context) => {
		context.header("Allow", "GET, HEAD");
		return context.json(apiError("method_not_allowed"), 405);
	});
	return routes;
}
