import type { MiddlewareHandler } from "hono";

export class AccessRejectedError extends Error {
	constructor() {
		super("Request forbidden");
		this.name = "AccessRejectedError";
	}
}

type Deps = { port: number };

export function createRequestGuard({ port }: Deps): MiddlewareHandler {
	const host = `127.0.0.1:${port}`;
	const origin = `http://${host}`;
	return async (context, next) => {
		const headers = context.req.raw.headers;
		if (headers.get("host") !== host || (headers.has("origin") && headers.get("origin") !== origin)) {
			throw new AccessRejectedError();
		}
		await next();
	};
}
