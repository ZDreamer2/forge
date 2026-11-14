import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerHubRoutes } from "../index.ts";

const server = {
	id: "one",
	name: "One",
	url: "https://example.com/",
	availability: { status: "unknown" as const, checkedAt: null, lastReachableAt: null, error: null, stale: true },
};

test("host inspection maps only approved fields and does not await probes", async () => {
	let calls = 0;
	const routes = createServerHubRoutes({
		inspectServerHub: () => {
			calls++;
			return { servers: [{ ...server, secret: "private" }], secret: "private" };
		},
	});
	const response = await routes.request("/server-hub/servers");
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { servers: [server] });
	const head = await routes.request("/server-hub/servers", { method: "HEAD" });
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
	assert.equal(calls, 2);
	for (const query of ["?unknown", "?id=one", "?id=one&id=two"]) {
		assert.equal((await routes.request(`/server-hub/servers${query}`)).status, 400);
	}
	assert.equal(calls, 2);
	for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
		const invalid = await routes.request("/server-hub/servers", { method });
		assert.equal(invalid.status, 405);
		assert.equal(invalid.headers.get("allow"), "GET, HEAD");
	}
	assert.equal(calls, 2);
});

test("unavailable configuration is distinct from an accepted empty list", async () => {
	const unavailable = createServerHubRoutes({ inspectServerHub: () => null });
	const response = await unavailable.request("/server-hub/servers");
	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), {
		error: {
			code: "internal_error",
			message: "Server hub registrations are unavailable; repair configuration and reload",
		},
	});
	const empty = createServerHubRoutes({ inspectServerHub: () => ({ servers: [] }) });
	const accepted = await empty.request("/server-hub/servers");
	assert.equal(accepted.status, 200);
	assert.deepEqual(await accepted.json(), { servers: [] });
});
