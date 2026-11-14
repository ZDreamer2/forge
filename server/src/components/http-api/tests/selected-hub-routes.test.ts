import assert from "node:assert/strict";
import { test } from "node:test";
import type { SelectedHubSnapshot } from "../../server-hub/index.ts";
import { createSelectedHubRoutes } from "../index.ts";

const server = {
	id: "one",
	name: "One",
	url: "http://127.0.0.1:43100/",
	availability: { status: "unknown" as const, checkedAt: null, lastReachableAt: null, error: null, stale: true },
};

const snapshots: SelectedHubSnapshot[] = [
	{ source: { status: "unconfigured", url: null }, servers: null, lastSuccessAt: null, error: null, stale: false },
	{
		source: { status: "configuration-unavailable", url: null },
		servers: null,
		lastSuccessAt: null,
		error: "Repair configuration",
		stale: true,
	},
	{
		source: { status: "selected", url: "http://127.0.0.1:43100/" },
		servers: null,
		lastSuccessAt: null,
		error: null,
		stale: true,
	},
	{
		source: { status: "selected", url: "http://127.0.0.1:43100/" },
		servers: [],
		lastSuccessAt: "2026-01-01T00:00:00.000Z",
		error: null,
		stale: false,
	},
	{
		source: { status: "selected", url: "http://127.0.0.1:43100/" },
		servers: [server],
		lastSuccessAt: "2026-01-01T00:00:00.000Z",
		error: "Fetch failed",
		stale: true,
	},
];

test("selection inspection maps immediate null, empty and retained snapshots without private fields", async () => {
	for (const snapshot of snapshots) {
		let calls = 0;
		const routes = createSelectedHubRoutes({
			inspectSelectedHub: () => {
				calls++;
				return {
					...snapshot,
					secret: "private",
					source: { ...snapshot.source, path: "/private/config.yaml" },
					servers:
						snapshot.servers?.map((entry) => ({
							...entry,
							secret: "private",
							availability: { ...entry.availability, secret: "private" },
						})) ?? null,
				};
			},
		});
		const response = await routes.request("/server-hub/selection");
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), snapshot);
		const head = await routes.request("/server-hub/selection", { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(await head.text(), "");
		assert.equal(calls, 2);
	}
});

test("selection rejects queries and unsupported methods without inspecting", async () => {
	let calls = 0;
	const routes = createSelectedHubRoutes({
		inspectSelectedHub: () => {
			calls++;
			return {
				source: { status: "unconfigured", url: null },
				servers: null,
				lastSuccessAt: null,
				error: null,
				stale: false,
			};
		},
	});
	for (const query of ["?unknown", "?id=one", "?id=one&id=two"]) {
		assert.equal((await routes.request(`/server-hub/selection${query}`)).status, 400);
	}
	for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
		const response = await routes.request("/server-hub/selection", { method });
		assert.equal(response.status, 405);
		assert.equal(response.headers.get("allow"), "GET, HEAD");
	}
	assert.equal(calls, 0);
});
