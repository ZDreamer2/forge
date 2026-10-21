import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpApp } from "./http.ts";

test("HTTP page and API operations have consistent routing failures", async () => {
	let collections = 0;
	const app = createHttpApp({
		root: "/selected",
		repositories: [],
		port: 43210,
		collectChanges: async () => {
			collections++;
			return { codebases: {}, changes: [] };
		},
	});
	const headers = { host: "127.0.0.1:43210" };
	const response = await app.request("/api/workspace", { headers });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { workspace: { root: "/selected" }, repositories: [] });
	assert.equal(response.headers.get("access-control-allow-origin"), null);
	for (const path of ["/workspace", "/changes", "/api/unknown"]) {
		for (const method of ["GET", "OPTIONS"]) {
			const missing = await app.request(path, { method, headers });
			assert.equal(missing.status, 404);
			assert.deepEqual(await missing.json(), { error: { code: "not_found", message: "Not found" } });
		}
	}
	for (const path of ["/", "/api/workspace", "/api/changes"]) {
		for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
			const unsupported = await app.request(path, { method, headers });
			assert.equal(unsupported.status, 405);
			assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
			assert.deepEqual(await unsupported.json(), {
				error: { code: "method_not_allowed", message: "Method not allowed" },
			});
			assert.equal(unsupported.headers.get("access-control-allow-origin"), null);
		}
	}
	const page = await app.request("/", { headers });
	assert.equal(page.status, 200);
	assert.match(await page.text(), /Forge workspace/);
	const pageHead = await app.request("/", { method: "HEAD", headers });
	assert.equal(pageHead.status, 200);
	assert.equal(await pageHead.text(), "");
	assert.equal(collections, 0);
	const changes = await app.request("/api/changes", { headers });
	assert.equal(changes.status, 200);
	assert.deepEqual(await changes.json(), { codebases: {}, changes: [] });
	assert.equal(collections, 1);
	const head = await app.request("/api/workspace", { method: "HEAD", headers });
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
	const changesHead = await app.request("/api/changes", { method: "HEAD", headers });
	assert.equal(changesHead.status, 200);
	assert.equal(await changesHead.text(), "");
	assert.equal(collections, 2);
});

test("access rejection precedes all paths and unexpected failures reveal no diagnostics", async () => {
	let collections = 0;
	const reported: Error[] = [];
	const app = createHttpApp({
		root: "/selected",
		repositories: [],
		port: 43210,
		collectChanges: async () => {
			collections++;
			throw new Error("secret subprocess and environment values");
		},
		reportError: (error) => reported.push(error),
	});
	let reached = false;
	app.get("/explode", () => {
		reached = true;
		throw new Error("secret subprocess and environment values");
	});
	for (const path of ["/", "/explode", "/api/workspace", "/api/changes", "/api/unknown"]) {
		for (const headers of [{ host: "foreign:43210" }, { host: "127.0.0.1:43210", origin: "http://foreign:43210" }]) {
			for (const method of ["GET", "HEAD", "OPTIONS"]) {
				const denied = await app.request(path, { method, headers });
				assert.equal(denied.status, 403);
				if (method !== "HEAD") {
					assert.deepEqual(await denied.json(), { error: { code: "forbidden", message: "Request forbidden" } });
				}
			}
		}
	}
	assert.equal(reported.length, 0);
	assert.equal(reached, false);
	assert.equal(collections, 0);
	for (const path of ["/explode", "/api/changes"]) {
		const failed = await app.request(path, { headers: { host: "127.0.0.1:43210" } });
		assert.equal(failed.status, 500);
		assert.deepEqual(await failed.json(), { error: { code: "internal_error", message: "Internal server error" } });
	}
	assert.equal(collections, 1);
	assert.deepEqual(
		reported.map((error) => error.message),
		["secret subprocess and environment values", "secret subprocess and environment values"],
	);
});
