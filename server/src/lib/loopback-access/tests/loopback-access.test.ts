import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { AccessRejectedError, createRequestGuard } from "../index.ts";

test("guard checks configured authority and every supplied origin before handlers", async () => {
	const app = new Hono();
	let calls = 0;
	app.onError((error, context) => {
		assert.ok(error instanceof AccessRejectedError);
		return context.text("denied", 403);
	});
	app.use("*", createRequestGuard({ port: 43210 }));
	app.all("*", (context) => {
		calls++;
		return context.text("accepted");
	});
	const host = "127.0.0.1:43210";
	for (const headers of [
		{},
		{ host: "localhost:43210" },
		{ host: "127.0.0.1:43211" },
		{ host: "127.0.0.1" },
		{ host: `${host}, ${host}` },
		{ host, origin: "null" },
		{ host, origin: "" },
		{ host, origin: "https://127.0.0.1:43210" },
		{ host, origin: "http://127.0.0.1:43211" },
		{ host, origin: `http://${host}, http://${host}` },
		{ host: "foreign", "x-forwarded-host": host, forwarded: `host=${host}` },
	]) {
		for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
			assert.equal((await app.request("/unknown", { headers, method })).status, 403);
		}
	}
	assert.equal(calls, 0);
	for (const headers of [{ host }, { host, origin: `http://${host}` }]) {
		assert.equal((await app.request("/", { headers })).status, 200);
	}
	assert.equal(calls, 2);
});
