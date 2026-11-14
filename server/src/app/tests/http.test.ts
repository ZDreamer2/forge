import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTreeAnalyzer } from "../../components/tree-analysis/index.ts";
import { createWorkspaceTree } from "../../components/workspace-tree/index.ts";
import { createHttpApp } from "../http.ts";

test("HTTP page and API operations have consistent routing failures", async (t) => {
	const uiDirectory = await mkdtemp(join(tmpdir(), "forge-http-assets-"));
	t.after(() => rm(uiDirectory, { recursive: true, force: true }));
	await mkdir(join(uiDirectory, "assets"));
	await writeFile(
		join(uiDirectory, "index.html"),
		'<div id="root"></div><script type="module" src="/assets/index-abcd.js"></script>',
	);
	await writeFile(join(uiDirectory, "assets/index-abcd.js"), "export {};\n");
	let collections = 0;
	const app = createHttpApp({
		inspectSelectedHub: () => ({
			source: { status: "unconfigured", url: null },
			servers: null,
			lastSuccessAt: null,
			error: null,
			stale: false,
		}),
		reloadConfiguration: async () => {
			throw new Error("Unexpected configuration reload");
		},
		guidance: { workspace: [], codebases: {} },
		uiDirectory,
		fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		fileDiff: async () => ({ kind: "not_changed" }),
		root: "/selected",
		name: "Selected",
		repositories: [],
		port: 43210,
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		discoverChanges: async () => ({ kind: "working-changes-discovery" }),
		changesRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		materializeChanges: async () => {
			collections++;
			return createWorkspaceTree({ root: "/selected", repositories: [], codebases: [] });
		},
	});
	const headers = { host: "127.0.0.1:43210" };
	const selection = await app.request("/api/server-hub/selection", { headers });
	assert.equal(selection.status, 200);
	assert.deepEqual(await selection.json(), {
		source: { status: "unconfigured", url: null },
		servers: null,
		lastSuccessAt: null,
		error: null,
		stale: false,
	});
	const selectionHead = await app.request("/api/server-hub/selection", { method: "HEAD", headers });
	assert.equal(selectionHead.status, 200);
	assert.equal(await selectionHead.text(), "");
	const response = await app.request("/api/workspace", { headers });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { workspace: { root: "/selected", name: "Selected" }, repositories: [] });
	assert.equal(response.headers.get("access-control-allow-origin"), null);
	for (const path of [
		"/workspace",
		"/changes",
		"/api/unknown",
		"/api/server-hub/servers",
		"/assets/missing.js",
		"/assets/%2fsecret.js",
	]) {
		for (const method of ["GET", "OPTIONS"]) {
			const missing = await app.request(path, { method, headers });
			assert.equal(missing.status, 404);
			assert.deepEqual(await missing.json(), { error: { code: "not_found", message: "Not found" } });
		}
	}
	for (const path of [
		"/",
		"/assets/index-abcd.js",
		"/api/workspace",
		"/api/changes",
		"/api/changes/analysis",
		"/api/changes/file",
		"/api/server-hub/selection",
	]) {
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
	assert.match(await page.text(), /<div id="root"><\/div><script type="module"/);
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

test("access rejection precedes all paths and unexpected failures reveal no diagnostics", async (t) => {
	const uiDirectory = await mkdtemp(join(tmpdir(), "forge-http-assets-"));
	t.after(() => rm(uiDirectory, { recursive: true, force: true }));
	await mkdir(join(uiDirectory, "assets"));
	await writeFile(
		join(uiDirectory, "index.html"),
		'<div id="root"></div><script type="module" src="/assets/index-abcd.js"></script>',
	);
	await writeFile(join(uiDirectory, "assets/index-abcd.js"), "export {};\n");
	let collections = 0;
	const reported: Error[] = [];
	let reloads = 0;
	let inspections = 0;
	let selectedInspections = 0;
	const app = createHttpApp({
		inspectSelectedHub: () => {
			selectedInspections++;
			return {
				source: { status: "unconfigured", url: null },
				servers: null,
				lastSuccessAt: null,
				error: null,
				stale: false,
			};
		},
		serverHub: {
			inspectServerHub: () => {
				inspections++;
				return { servers: [] };
			},
		},
		reloadConfiguration: async () => {
			reloads++;
			throw new Error("secret configuration failure");
		},
		guidance: { workspace: [], codebases: {} },
		uiDirectory,
		fileRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		fileDiff: async () => ({ kind: "not_changed" }),
		root: "/selected",
		name: "Selected",
		repositories: [],
		port: 43210,
		analysis: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
		currentByteSize: async () => 0,
		discoverChanges: async () => ({ kind: "working-changes-discovery" }),
		changesRequests: { run: (work) => work(new AbortController().signal, (pending) => pending) },
		materializeChanges: async () => {
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
	for (const path of [
		"/",
		"/assets/index-abcd.js",
		"/assets/missing.js",
		"/explode",
		"/api/workspace",
		"/api/changes",
		"/api/changes/analysis",
		"/api/changes/file",
		"/api/unknown",
		"/api/server-hub/servers",
		"/api/server-hub/selection",
		"/api/configuration/reload",
	]) {
		for (const headers of [
			{},
			{ host: "foreign:43210" },
			{ host: "127.0.0.1:43210", origin: "http://foreign:43210" },
			{ host: "127.0.0.1:43210", origin: "null" },
		]) {
			for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
				const denied = await app.request(path, {
					method,
					headers: { ...headers, "content-type": "application/json" },
					...(method === "POST" ? { body: "{}" } : {}),
				});
				assert.equal(denied.status, 403);
				assert.equal(denied.headers.get("access-control-allow-origin"), null);
				if (method !== "HEAD") {
					assert.deepEqual(await denied.json(), { error: { code: "forbidden", message: "Request forbidden" } });
				}
			}
		}
	}
	assert.equal(inspections, 0);
	assert.equal(selectedInspections, 0);
	const hubHeaders = { host: "127.0.0.1:43210" };
	const selected = await app.request("/api/server-hub/selection", { headers: hubHeaders });
	assert.equal(selected.status, 200);
	assert.deepEqual(await selected.json(), {
		source: { status: "unconfigured", url: null },
		servers: null,
		lastSuccessAt: null,
		error: null,
		stale: false,
	});
	const selectedHead = await app.request("/api/server-hub/selection", { method: "HEAD", headers: hubHeaders });
	assert.equal(selectedHead.status, 200);
	assert.equal(await selectedHead.text(), "");
	assert.equal(selectedInspections, 2);
	const hub = await app.request("/api/server-hub/servers", { headers: hubHeaders });
	assert.equal(hub.status, 200);
	assert.deepEqual(await hub.json(), { servers: [] });
	const hubHead = await app.request("/api/server-hub/servers", { method: "HEAD", headers: hubHeaders });
	assert.equal(hubHead.status, 200);
	assert.equal(await hubHead.text(), "");
	const hubOptions = await app.request("/api/server-hub/servers", { method: "OPTIONS", headers: hubHeaders });
	assert.equal(hubOptions.status, 405);
	assert.equal(hubOptions.headers.get("allow"), "GET, HEAD");
	for (const response of [hub, hubHead, hubOptions]) {
		assert.equal(response.headers.get("access-control-allow-origin"), null);
	}
	assert.equal(inspections, 2);
	assert.equal(reported.length, 0);
	assert.equal(reloads, 0);
	assert.equal(reached, false);
	assert.equal(collections, 0);
	for (const path of ["/explode", "/api/changes"]) {
		const failed = await app.request(path, { headers: { host: "127.0.0.1:43210" } });
		assert.equal(failed.status, 500);
		assert.deepEqual(await failed.json(), { error: { code: "internal_error", message: "Internal server error" } });
	}
	assert.equal(collections, 1);
	const reloadFailure = await app.request("/api/configuration/reload", {
		method: "POST",
		headers: { host: "127.0.0.1:43210", "content-type": "application/json" },
		body: "{}",
	});
	assert.equal(reloadFailure.status, 500);
	assert.deepEqual(await reloadFailure.json(), { error: { code: "internal_error", message: "Internal server error" } });
	assert.equal(reloads, 1);
	assert.deepEqual(
		reported.map((error) => error.message),
		[
			"secret subprocess and environment values",
			"secret subprocess and environment values",
			"secret configuration failure",
		],
	);
});
