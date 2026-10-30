import assert from "node:assert/strict";
import { once } from "node:events";
import { Agent, request } from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import { createTreeAnalyzer } from "../../components/tree-analysis/index.ts";
import { createWorkspaceTree } from "../../components/workspace-tree/index.ts";
import { createHttpApp } from "../http.ts";
import { createListener } from "../listener.ts";

test("shutdown bounds an active request drain", { timeout: 5000 }, async () => {
	const entered = Promise.withResolvers<void>();
	const response = Promise.withResolvers<Response>();
	const listener = await createListener({
		port: 0,
		fetch: () => {
			entered.resolve();
			return response.promise;
		},
	});
	const client = request(listener.address);
	client.on("error", () => {});
	const closed = new Promise<void>((resolve) => client.once("close", resolve));
	try {
		client.end();
		await entered.promise;
		await listener.close();
		await closed;
	} finally {
		response.resolve(new Response());
		client.destroy();
		await listener.close();
	}
});

test("listener reports readiness, refuses occupied port and disposes idle and incomplete sockets", {
	timeout: 5000,
}, async () => {
	const listener = await createListener({ fetch: () => new Response("ready"), port: 0 });
	const agent = new Agent({ keepAlive: true });
	let socket: ReturnType<typeof connect> | undefined;
	try {
		assert.match(listener.address, /^http:\/\/127\.0\.0\.1:\d+$/);
		const port = Number(new URL(listener.address).port);
		await assert.rejects(createListener({ fetch: () => new Response(), port }), { code: "EADDRINUSE" });
		const body = await new Promise<string>((resolve, reject) => {
			request(listener.address, { agent }, (response) => {
				let result = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					result += chunk;
				});
				response.on("end", () => resolve(result));
			})
				.on("error", reject)
				.end();
		});
		assert.equal(body, "ready");
		socket = connect(port, "127.0.0.1");
		await once(socket, "connect");
		socket.on("error", () => {});
		socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n");
		const closed = new Promise<void>((resolve) => socket?.once("close", () => resolve()));
		await Promise.all([listener.close(), listener.close()]);
		await closed;
		await listener.close();
	} finally {
		socket?.destroy();
		agent.destroy();
		await listener.close();
	}
});

test("real adapter preserves Host and Origin restrictions including spoofed forwarded authority", {
	timeout: 5000,
}, async () => {
	let port = 0;
	const listener = await createListener({
		port: 0,
		fetch: (incoming) =>
			createHttpApp({
				fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
				fileDiff: async () => ({ kind: "not_changed" }),
				root: "/selected",
				name: "Selected",
				repositories: [],
				port,
				analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
				analyze: createTreeAnalyzer({ handlers: [] }).analyze,
				currentByteSize: async () => 0,
				collectChanges: async () => createWorkspaceTree({ root: "/selected", repositories: [], codebases: [] }),
			}).fetch(incoming),
	});
	port = Number(new URL(listener.address).port);
	try {
		for (const headers of [
			{ host: `localhost:${port}` },
			{ host: `127.0.0.1:${port}`, origin: "null" },
			{ host: `127.0.0.1:${port}`, origin: `http://localhost:${port}` },
			{ host: "foreign", "x-forwarded-host": `127.0.0.1:${port}` },
			{ host: "bad host" },
		]) {
			await new Promise<void>((resolve, reject) => {
				request(`${listener.address}/api/workspace`, { headers }, (response) => {
					let body = "";
					response.setEncoding("utf8");
					response.on("data", (chunk) => {
						body += chunk;
					});
					response.on("end", () => {
						try {
							assert.equal(response.statusCode, 403);
							assert.equal(JSON.parse(body).error.code, "forbidden");
							assert.equal(response.headers["access-control-allow-origin"], undefined);
							resolve();
						} catch (error) {
							reject(error);
						}
					});
				})
					.on("error", reject)
					.end();
			});
		}
		assert.equal((await fetch(`${listener.address}/api/workspace`)).status, 200);
	} finally {
		await listener.close();
	}
});
