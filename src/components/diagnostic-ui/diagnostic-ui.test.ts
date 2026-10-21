import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createDiagnosticRoutes } from "./index.ts";

test("diagnostic route serves its fixed document and inline script on GET and HEAD", async () => {
	const app = createDiagnosticRoutes();
	const response = await app.request("/");
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/html/);
	const document = await response.text();
	assert.match(document, /<button id="refresh" type="button">Refresh<\/button>/);
	assert.match(document, /load\("\/api\/workspace",/);
	assert.match(document, /load\("\/api\/changes",/);
	assert.match(document, /<script>[\s\S]+<\/script>/);
	const head = await app.request("/", { method: "HEAD" });
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
	for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
		const unsupported = await app.request("/", { method });
		assert.equal(unsupported.status, 405);
		assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
	}
	assert.equal((await app.request("/unknown")).status, 404);
});

class Element {
	textContent = "";
	className = "";
	disabled = false;
	children: Element[] = [];
	click: (() => Promise<void>) | undefined;

	append(...children: Element[]) {
		this.children.push(...children);
	}

	replaceChildren(...children: Element[]) {
		this.children = children;
	}

	addEventListener(event: string, callback: () => Promise<void>) {
		assert.equal(event, "click");
		this.click = callback;
	}

	set innerHTML(_html: string) {
		assert.fail("Workspace values must render through textContent");
	}
}

async function browserScript() {
	const response = await createDiagnosticRoutes().request("/");
	const script = (await response.text()).match(/<script>([\s\S]+)<\/script>/)?.[1];
	assert.ok(script);
	const elements = new Map<string, Element>();
	const element = (id: string) => {
		let existing = elements.get(id);
		if (!existing) {
			existing = new Element();
			elements.set(id, existing);
		}
		return existing;
	};
	const requests: {
		path: string;
		signal: AbortSignal;
		resolve: (body: unknown, status?: number) => void;
		reject: (error: Error) => void;
	}[] = [];
	const timers = new Map<number, () => void>();
	let nextTimer = 0;
	const document = { title: "Forge", getElementById: element, createElement: () => new Element() };
	runInNewContext(script, {
		document,
		AbortController,
		fetch: (path: string, options: { signal: AbortSignal; cache: string }) => {
			assert.equal(options.cache, "no-store");
			return new Promise((resolve, reject) => {
				requests.push({
					path,
					signal: options.signal,
					resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }),
					reject,
				});
			});
		},
		setTimeout: (callback: () => void, delay: number) => {
			assert.equal(delay, 35_000);
			timers.set(++nextTimer, callback);
			return nextTimer;
		},
		clearTimeout: (id: number) => timers.delete(id),
	});
	return {
		document,
		element,
		requests,
		timers,
		settle: () => new Promise<void>((resolve) => setImmediate(resolve)),
	};
}

for (const failing of ["/api/workspace", "/api/changes"]) {
	test(`${failing} error appears while the independent request remains pending`, async () => {
		const browser = await browserScript();
		assert.equal(browser.requests.length, 2);
		const failed = browser.requests.find((request) => request.path === failing);
		const pending = browser.requests.find((request) => request.path !== failing);
		assert.ok(failed && pending);
		failed.resolve({}, 500);
		await browser.settle();
		const region = failing === "/api/workspace" ? "identity-error" : "changes-error";
		assert.match(browser.element(region).textContent, /HTTP 500.*Use Refresh to retry/);
		assert.match(browser.element("status").textContent, /Refresh failed/);
		assert.equal(browser.element("refresh").disabled, true);
		pending.resolve(
			failing === "/api/workspace"
				? { codebases: {}, changes: [] }
				: { workspace: { root: "/fixture" }, repositories: [] },
		);
		await browser.settle();
		assert.equal(browser.element("refresh").disabled, false);
		assert.equal(browser.timers.size, 0);
	});
}

test("refresh retains useful identity, clears old changes and renders workspace values literally", async () => {
	const browser = await browserScript();
	browser.requests[0]?.resolve({
		workspace: { root: "/<workspace>", name: "</title><script>throw 1</script> & BiCo" },
		repositories: [{ path: "<repo>", status: "missing" }],
	});
	browser.requests[1]?.resolve({
		codebases: { "<id>": { guidance: "<guidance>" }, ["__proto__"]: { guidance: "<guidance>" } },
		changes: [
			{
				repo: "<repo>",
				path: "<script>.txt",
				kind: "renamed",
				from: "<old>",
				codebases: ["<id>", "__proto__"],
			},
		],
	});
	await browser.settle();
	assert.equal(browser.document.title, "🛠️ </title><script>throw 1</script> & BiCo");
	const texts = (element: Element): string[] => [element.textContent, ...element.children.flatMap(texts)];
	assert.ok(texts(browser.element("identity")).includes("/<workspace>"));
	const rendered = texts(browser.element("changes"));
	assert.ok(rendered.includes("<repo> · <script>.txt — renamed"));
	assert.ok(rendered.includes("From: <old>"));
	assert.ok(rendered.includes("<id> — <guidance>"));
	assert.ok(rendered.includes("__proto__ — <guidance>"));
	assert.equal(browser.element("status").textContent, "Up to date.");
	const retained = browser.element("identity").children;
	const refreshed = browser.element("refresh").click?.();
	assert.equal(browser.element("identity").children, retained);
	assert.deepEqual(browser.element("changes").children, []);
	browser.requests[2]?.reject(new Error("offline"));
	browser.requests[3]?.resolve({}, 503);
	await refreshed;
	assert.equal(browser.element("identity").children, retained);
	assert.deepEqual(browser.element("changes").children, []);
	assert.equal(browser.document.title, "Forge");
	assert.match(browser.element("identity-error").textContent, /offline/);
	assert.match(browser.element("changes-error").textContent, /HTTP 503/);
	assert.equal(browser.element("refresh").disabled, false);
});

test("client deadline aborts stalled requests and restores successful retry", async () => {
	const browser = await browserScript();
	for (const callback of [...browser.timers.values()]) callback();
	await browser.settle();
	assert.ok(browser.requests.every((request) => request.signal.aborted));
	assert.match(browser.element("identity-error").textContent, /Request timed out/);
	assert.match(browser.element("changes-error").textContent, /Request timed out/);
	assert.equal(browser.element("refresh").disabled, false);
	assert.equal(browser.timers.size, 0);
	const refreshed = browser.element("refresh").click?.();
	assert.equal(browser.element("identity-error").textContent, "");
	assert.equal(browser.element("changes-error").textContent, "");
	browser.requests[2]?.resolve({ workspace: { root: "/retry", name: "BiCo" }, repositories: [] });
	browser.requests[3]?.resolve({ codebases: {}, changes: [] });
	await refreshed;
	assert.equal(browser.element("status").textContent, "Up to date.");
	assert.equal(browser.element("changes").children[0]?.textContent, "No uncommitted changes.");
	assert.equal(browser.element("refresh").disabled, false);
	// Late responses from an expired refresh cannot overwrite the successful retry.
	browser.requests[0]?.resolve({ workspace: { root: "/expired" }, repositories: [] });
	browser.requests[1]?.resolve({ codebases: {}, changes: [] });
	await browser.settle();
	assert.equal(browser.element("identity").children[0]?.textContent, "/retry");
	assert.equal(browser.document.title, "🛠️ BiCo");
});
