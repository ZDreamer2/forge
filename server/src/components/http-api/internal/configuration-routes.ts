import { Hono } from "hono";
import type { ConfigurationReloadResult } from "../../configuration/index.ts";
import { apiError } from "./wire.ts";

export type ConfigurationRouteDeps = {
	reloadConfiguration: () => Promise<ConfigurationReloadResult>;
};

export function createConfigurationRoutes({ reloadConfiguration }: ConfigurationRouteDeps) {
	const routes = new Hono();
	routes.post("/configuration/reload", async (context) => {
		if (
			new URL(context.req.url).searchParams.size !== 0 ||
			context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
			!(await emptyObjectBody(context.req.raw))
		) {
			return context.json(apiError("invalid_request"), 400);
		}
		const result = await reloadConfiguration();
		const concern = (value: ConfigurationReloadResult["concerns"]["serverHubUrl"]) => ({
			status: value.status,
			source: { scope: value.source.scope, path: value.source.path, provenance: value.source.provenance },
			retainedPriorValue: value.retainedPriorValue,
			...(value.status === "rejected" ? { diagnostic: value.diagnostic.replace(/\p{Cc}/gu, " ").slice(0, 1600) } : {}),
		});
		return context.json({
			ok: result.ok,
			concerns: {
				serverHubUrl: concern(result.concerns.serverHubUrl),
				servers: concern(result.concerns.servers),
				currentIssue: concern(result.concerns.currentIssue),
			},
		});
	});
	routes.all("/configuration/reload", (context) => {
		context.header("Allow", "POST");
		return context.json(apiError("method_not_allowed"), 405);
	});
	return routes;
}

async function emptyObjectBody(request: Request): Promise<boolean> {
	const reader = request.body?.getReader();
	if (!reader) return false;
	try {
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 1024) {
				void reader.cancel().catch(() => {});
				return false;
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
	} catch {
		return false;
	} finally {
		reader.releaseLock();
	}
}
