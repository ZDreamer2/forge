import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigurationReloadResult } from "../../configuration/index.ts";
import { createConfigurationRoutes } from "../index.ts";

function result(): ConfigurationReloadResult {
	return {
		ok: false,
		concerns: {
			serverHubUrl: {
				status: "accepted",
				source: { scope: "user", path: "/user/config.yaml", provenance: "file" },
				retainedPriorValue: false,
			},
			servers: {
				status: "rejected",
				source: { scope: "user", path: "/user/server-hub.yaml", provenance: "file" },
				retainedPriorValue: true,
				diagnostic: "servers[0].id: expected a unique slug",
			},
			currentIssue: {
				status: "accepted",
				source: { scope: "workspace", path: "/guide/.local/state.json", provenance: "default" },
				retainedPriorValue: false,
			},
		},
	};
}

test("reload maps independent concern outcomes without returning accepted values or unrelated state", async () => {
	let calls = 0;
	const expected = result();
	const routes = createConfigurationRoutes({
		reloadConfiguration: async () => {
			calls++;
			return { ...expected, secret: "private" };
		},
	});
	const response = await routes.request("/configuration/reload", {
		method: "POST",
		headers: { "content-type": "application/json; charset=utf-8" },
		body: " {} \n",
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), expected);
	assert.equal(calls, 1);
	const accepted: ConfigurationReloadResult = {
		ok: true,
		concerns: { ...expected.concerns, servers: expected.concerns.serverHubUrl },
	};
	const allAccepted = createConfigurationRoutes({ reloadConfiguration: async () => accepted });
	assert.deepEqual(
		await (
			await allAccepted.request("/configuration/reload", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			})
		).json(),
		accepted,
	);
});

test("invalid media, query, JSON and oversized bodies never invoke reload", async () => {
	let calls = 0;
	const routes = createConfigurationRoutes({
		reloadConfiguration: async () => {
			calls++;
			return result();
		},
	});
	const invalid = [
		{ body: "{}", media: "text/plain" },
		{ body: "{}", media: "application/problem+json" },
		{ body: "{}", media: "" },
		...["", "{", "null", "[]", "true", '"{}"', '{"scope":"user"}', '{"__proto__":{}}', `${" ".repeat(1023)}{}`].map(
			(body) => ({ body, media: "application/json" }),
		),
		{ body: "{}", media: "application/json", query: "?scope=user" },
		{ body: "{}", media: "application/json", query: "?unknown" },
	];
	for (const input of invalid) {
		const response = await routes.request(`/configuration/reload${input.query ?? ""}`, {
			method: "POST",
			headers: input.media ? { "content-type": input.media } : {},
			body: input.body,
		});
		assert.equal(response.status, 400, JSON.stringify(input));
		assert.deepEqual(await response.json(), { error: { code: "invalid_request", message: "Invalid request" } });
	}
	const malformedUtf8 = await routes.request("/configuration/reload", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: new Uint8Array([0xff, 123, 125]),
	});
	assert.equal(malformedUtf8.status, 400);
	assert.equal(calls, 0);
});

test("streamed bodies enforce the byte limit regardless of content-length", async () => {
	let calls = 0;
	let cancelled = false;
	const routes = createConfigurationRoutes({
		reloadConfiguration: async () => {
			calls++;
			return result();
		},
	});
	const request = new Request("http://localhost/configuration/reload", {
		method: "POST",
		headers: { "content-type": "application/json", "content-length": "2" },
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(" ".repeat(1024)));
				controller.enqueue(new TextEncoder().encode("{}"));
			},
			cancel() {
				cancelled = true;
			},
		}),
		duplex: "half",
	} as RequestInit);
	assert.equal((await routes.request(request)).status, 400);
	assert.equal(calls, 0);
	assert.equal(cancelled, true);
});

test("only POST is supported, including HEAD and OPTIONS", async () => {
	let calls = 0;
	const routes = createConfigurationRoutes({
		reloadConfiguration: async () => {
			calls++;
			return result();
		},
	});
	for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
		const response = await routes.request("/configuration/reload", { method });
		assert.equal(response.status, 405, method);
		assert.equal(response.headers.get("allow"), "POST");
	}
	assert.equal(calls, 0);
});
