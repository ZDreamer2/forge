import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { createUiAssetRoutes } from "../index.ts";

test("built UI files have exact paths, content types, HEAD and known-resource method semantics", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "forge-ui-assets-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await mkdir(join(directory, "assets"));
	const fixtures = [
		["index.html", "/", "text/html", '<div id="root"></div>'],
		["assets/index-A123.js", "/assets/index-A123.js", "text/javascript", "export {};"],
		["assets/index-A123.css", "/assets/index-A123.css", "text/css", "body { color: black; }"],
		["assets/emblem-A123.svg", "/assets/emblem-A123.svg", "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
		["assets/Mono-A123.woff2", "/assets/Mono-A123.woff2", "font/woff2", "wOF2 font fixture"],
	] as const;
	const app = new Hono().route("/", createUiAssetRoutes({ directory }));
	for (const [file, path, contentType, contents] of fixtures) {
		await writeFile(join(directory, file), contents);
		const response = await app.request(path);
		assert.equal(response.status, 200);
		assert.ok(response.headers.get("content-type")?.startsWith(contentType));
		assert.equal(await response.text(), contents);
		const head = await app.request(path, { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get("content-type"), response.headers.get("content-type"));
		assert.equal(await head.text(), "");
		for (const method of ["POST", "OPTIONS", "DELETE", "PATCH", "PUT"]) {
			const unsupported = await app.request(path, { method });
			assert.equal(unsupported.status, 405);
			assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
		}
	}
});

test("asset scope rejects missing files, directories, encoded paths and symlink escape without HTML fallback", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "forge-ui-containment-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const ui = join(directory, "ui");
	await mkdir(join(ui, "assets"), { recursive: true });
	await writeFile(join(ui, "index.html"), "application");
	await writeFile(join(directory, "secret.js"), "secret");
	await writeFile(join(ui, "private.json"), "private");
	await symlink(join(directory, "secret.js"), join(ui, "assets/escaped-A123.js"));
	await symlink(join(directory, "secret.js"), join(ui, "assets/escaped-A123.svg"));
	await symlink(join(directory, "secret.js"), join(ui, "assets/escaped-A123.woff2"));
	await mkdir(join(ui, "assets/directory-A123.js"));
	await mkdir(join(ui, "assets/directory-A123.svg"));
	await mkdir(join(ui, "assets/directory-A123.woff2"));
	const app = new Hono().route("/", createUiAssetRoutes({ directory: ui }));
	for (const path of [
		"/unknown",
		"/private.json",
		"/index.html",
		"/assets/",
		"/assets/missing-A123.js",
		"/assets/directory-A123.js",
		"/assets/escaped-A123.js",
		"/assets/escaped-A123.svg",
		"/assets/escaped-A123.woff2",
		"/assets/directory-A123.svg",
		"/assets/directory-A123.woff2",
		"/assets/missing-A123.svg",
		"/assets/missing-A123.woff2",
		"/assets/../private.json",
		"/assets/%2e%2e%2fsecret.js",
		"/assets/%2Fsecret.js",
		"/assets/%5csecret.js",
		"/assets/%ZZ.js",
		"/assets/%2e%2e%2fsecret.svg",
		"/assets/%2e%2e%2fsecret.woff2",
		"/assets/%2Fsecret.svg",
		"/assets/%5csecret.woff2",
		"/assets/nested/file.js",
		"/assets/nested/file.svg",
		"/assets/nested/file.woff2",
		"/assets/unsupported.png",
		"/assets/index.html",
	]) {
		for (const method of ["GET", "HEAD", "POST"]) {
			const response = await app.request(path, { method });
			assert.equal(response.status, 404, `${method} ${path}`);
			assert.equal(response.headers.get("allow"), null);
			assert.doesNotMatch(await response.text(), /application|secret|private/);
		}
	}
	assert.equal(
		(await new Hono().route("/", createUiAssetRoutes({ directory: join(directory, "missing") })).request("/")).status,
		404,
	);
});
