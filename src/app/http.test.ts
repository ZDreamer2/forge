import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpApp } from "./http.ts";

test("HTTP identity is mounted only under API with consistent routing failures", async () => {
	const app = createHttpApp({ root: "/selected", repositories: [], port: 43210 });
	const headers = { host: "127.0.0.1:43210" };
	const response = await app.request("/api/workspace", { headers });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { workspace: { root: "/selected" }, repositories: [] });
	assert.equal(response.headers.get("access-control-allow-origin"), null);
	for (const path of ["/", "/workspace", "/api/unknown", "/api/changes"]) {
		const missing = await app.request(path, { headers });
		assert.equal(missing.status, 404);
		assert.deepEqual(await missing.json(), { error: { code: "not_found", message: "Not found" } });
	}
	for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
		const unsupported = await app.request("/api/workspace", { method, headers });
		assert.equal(unsupported.status, 405);
		assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
		assert.deepEqual(await unsupported.json(), {
			error: { code: "method_not_allowed", message: "Method not allowed" },
		});
		assert.equal(unsupported.headers.get("access-control-allow-origin"), null);
	}
	const head = await app.request("/api/workspace", { method: "HEAD", headers });
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
});

test("access rejection precedes all paths and unexpected failures reveal no diagnostics", async () => {
	const app = createHttpApp({ root: "/selected", repositories: [], port: 43210 });
	let reached = false;
	app.get("/explode", () => {
		reached = true;
		throw new Error("secret subprocess and environment values");
	});
	for (const path of ["/explode", "/api/workspace", "/api/unknown"]) {
		const denied = await app.request(path, { headers: { host: "foreign:43210" } });
		assert.equal(denied.status, 403);
		assert.deepEqual(await denied.json(), { error: { code: "forbidden", message: "Request forbidden" } });
	}
	assert.equal(reached, false);
	const failed = await app.request("/explode", { headers: { host: "127.0.0.1:43210" } });
	assert.equal(failed.status, 500);
	assert.deepEqual(await failed.json(), { error: { code: "internal_error", message: "Internal server error" } });
});
