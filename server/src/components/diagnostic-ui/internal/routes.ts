import { Hono } from "hono";
import { page } from "./page.ts";

export function createDiagnosticRoutes() {
	const routes = new Hono();
	routes.get("/", (context) => context.html(page));
	routes.all("/", (context) => {
		context.header("Allow", "GET, HEAD");
		return context.json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405);
	});
	return routes;
}
