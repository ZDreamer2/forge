import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { type Handler, Hono } from "hono";

type Deps = { directory: string };

export function createUiAssetRoutes({ directory }: Deps) {
	const routes = new Hono();
	const serve: Handler = async (context) => {
		const path = context.req.path;
		if (path !== "/" && !/^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|css)$/.test(path)) return context.notFound();
		if (path.includes("..")) return context.notFound();
		let file: string;
		try {
			const root = await realpath(directory);
			file = await realpath(resolve(root, path === "/" ? "index.html" : path.slice(1)));
			const contained = relative(root, file);
			if (contained.startsWith("..") || isAbsolute(contained) || !(await stat(file)).isFile())
				return context.notFound();
		} catch (error) {
			if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) {
				return context.notFound();
			}
			throw error;
		}
		if (!["GET", "HEAD"].includes(context.req.method)) {
			context.header("Allow", "GET, HEAD");
			return context.json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405);
		}
		context.header(
			"Content-Type",
			path === "/"
				? "text/html; charset=utf-8"
				: path.endsWith(".js")
					? "text/javascript; charset=utf-8"
					: "text/css; charset=utf-8",
		);
		if (context.req.method === "HEAD") return context.body(null);
		return context.body(new Uint8Array(await readFile(file)));
	};
	routes.all("/", serve);
	routes.all("/assets/*", serve);
	return routes;
}
