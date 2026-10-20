import { createServer } from "node:http";
import type { Socket } from "node:net";
import { getRequestListener, RequestError } from "@hono/node-server";
import { apiError } from "../components/workspace-api/index.ts";

type Deps = {
	fetch: (request: Request) => Response | Promise<Response>;
	port: number;
};

export async function createListener({ fetch, port }: Deps) {
	const server = createServer(
		getRequestListener(fetch, {
			overrideGlobalObjects: false,
			errorHandler: (error) =>
				Response.json(apiError(error instanceof RequestError ? "forbidden" : "internal_error"), {
					status: error instanceof RequestError ? 403 : 500,
				}),
		}),
	);
	const sockets = new Set<Socket>();
	const onConnection = (socket: Socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	};
	server.on("connection", onConnection);
	try {
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				server.off("listening", onListening);
				reject(error);
			};
			const onListening = () => {
				server.off("error", onError);
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, "127.0.0.1");
		});
	} catch (error) {
		server.off("connection", onConnection);
		throw error;
	}
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing listener address");
	let closing: Promise<void> | undefined;
	return {
		address: `http://127.0.0.1:${address.port}`,
		close() {
			closing ??= new Promise<void>((resolve, reject) => {
				// Bound draining so an incomplete request cannot keep foreground shutdown alive.
				const timer = setTimeout(() => {
					for (const socket of sockets) socket.destroy();
				}, 500);
				server.close((error) => {
					clearTimeout(timer);
					server.off("connection", onConnection);
					if (error) reject(error);
					else resolve();
				});
			});
			return closing;
		},
	};
}
