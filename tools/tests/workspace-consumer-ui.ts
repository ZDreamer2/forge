import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { AnalysisWireNode, WorkspaceAnalysis } from "../../server/src/components/api-contract/index.ts";

type Deps = {
	address: string;
	workspace: string;
	workspaceName: string;
	sourceState: (workspace: string) => unknown;
	run(command: string, args: string[], cwd: string): string;
};

function row(page: Page, path: string) {
	return page
		.locator("[data-path]")
		.filter({ has: page.locator(`button[aria-pressed][aria-label=${JSON.stringify(`Select ${path}`)}]`) });
}

function select(page: Page, path: string) {
	return page.getByRole("button", { name: `Select ${path}`, exact: true });
}

async function summary(page: Page, label: string, files: number, removed: number, added: number) {
	await page
		.getByRole("button", {
			name: `${label}: ${files} changed files, ${removed} removed lines, ${added} added lines`,
			exact: true,
		})
		.waitFor();
}

function totals(nodes: AnalysisWireNode[]) {
	return nodes.reduce(
		(sum, node) => ({
			files: sum.files + 1,
			removed: sum.removed + (node.statistics?.binary ? 0 : (node.statistics?.removed ?? 0)),
			added: sum.added + (node.statistics?.binary ? 0 : (node.statistics?.added ?? 0)),
		}),
		{ files: 0, removed: 0, added: 0 },
	);
}

async function waitSelected(page: Page, path?: string) {
	await page.waitForURL((url) => url.searchParams.get("path") === (path ?? null));
	if (path) await select(page, path).waitFor({ state: "attached" });
}

async function settled(page: Page) {
	await page.getByRole("button", { name: "Refresh", exact: true }).and(page.locator(":enabled")).waitFor();
}

async function expectPortal(page: Page, trigger: Locator) {
	await trigger.hover();
	const tooltip = page.getByRole("tooltip");
	await tooltip.waitFor();
	assert.equal(
		await tooltip.evaluate((element) => !element.closest("main")),
		true,
		"Production tooltips must use their portal",
	);
	assert.equal(
		await tooltip.evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).backgroundColor),
		"rgb(255, 255, 255)",
	);
	await page.mouse.move(1090, 1);
	await tooltip.waitFor({ state: "hidden" });
	await trigger.focus();
	await tooltip.waitFor();
	await trigger.blur();
	await tooltip.waitFor({ state: "hidden" });
}

export async function verifyInstalledUi({ address, workspace, workspaceName, sourceState, run }: Deps) {
	const tracked = join(workspace, "app/tracked.txt");
	const original = readFileSync(tracked);
	const originalTransition = readFileSync(join(workspace, "app/transition"));
	const index = readFileSync(join(workspace, ".git/index"));
	const nested = join(workspace, "nested");
	const suspended = `${workspace}-suspended-repository`;
	const created = new Set<string>();
	const screenshots = mkdtempSync(join(tmpdir(), "forge-navigator-chromium-"));
	let moved = false;
	let renamed = false;
	let transitioned = false;
	function write(path: string, content: string | Buffer) {
		const target = join(workspace, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
		created.add(target);
	}
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
		page.setDefaultTimeout(10_000);
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: address });
		const pageErrors: string[] = [];
		const consoleErrors: string[] = [];
		const apiRequests: string[] = [];
		const assets: string[] = [];
		const assetResponses: { path: string; status: number; type: string }[] = [];
		const failedRequests: { url: string; error?: string }[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && !/the server responded with a status of 500/.test(message.text()))
				consoleErrors.push(message.text());
		});
		page.on("requestfailed", (request) =>
			failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
		);
		page.on("response", (response) => {
			const path = new URL(response.url()).pathname;
			if (path.startsWith("/assets/"))
				assetResponses.push({ path, status: response.status(), type: response.headers()["content-type"] ?? "" });
		});
		page.on("request", (request) => {
			const url = new URL(request.url());
			assert.equal(url.origin, address, "Assets and data must remain local");
			if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
			if (url.pathname.startsWith("/assets/")) assets.push(url.pathname);
		});
		const before = sourceState(workspace);
		assert.equal((await page.goto(address))?.status(), 200);
		await page.getByRole("heading", { name: workspaceName, exact: true }).waitFor();
		await summary(page, "All workspace changes", 0, 0, 0);
		assert.deepEqual(sourceState(workspace), before);
		assert.equal(await page.locator("html").getAttribute("data-mantine-color-scheme"), "light");
		await select(page, "not-cloned").click();
		await waitSelected(page, "not-cloned");
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/Missing at startup/i)
			.waitFor();
		await select(page, "nested").click();
		await waitSelected(page, "nested");
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/No changed entries/i)
			.waitFor();

		writeFileSync(tracked, "browser refresh\nsecond line\n");
		renameSync(join(workspace, "app/old.txt"), join(workspace, "other/renamed.txt"));
		renamed = true;
		run("git", ["add", "app/old.txt", "other/renamed.txt"], workspace);
		rmSync(join(workspace, "app/transition"));
		transitioned = true;
		write("app/transition/child.txt", "directory replaces file\n");
		write("nested/browser-binary.dat", Buffer.from([0, 4, 5, 6]));
		write("app/hidden.txt", "hidden by workspace guide\n");
		write("app/tests/check.test.ts", "test content\n");
		write("app/tests/critical.txt", "restored normal\n");
		write("app/settings.json", "{}\n");
		write("app/readme.md", "browser docs\n");
		write("app/logo.svg", "<svg/>\n");
		const unusual = `app/deep/${"long-directory-".repeat(7)}/Unicode café # % ? \\ file.ts`;
		write(unusual, "encoded browser path\n");
		for (let i = 0; i < 100; i++) write(`app/bulk/file-${String(i).padStart(3, "0")}.ts`, `bulk ${i}\n`);
		const edited = sourceState(workspace);
		const refresh = page.getByRole("button", { name: "Refresh", exact: true });
		await refresh.click();
		const analysisResponse = await fetch(`${address}/api/changes/analysis`);
		assert.equal(analysisResponse.status, 200);
		const analysis = (await analysisResponse.json()) as WorkspaceAnalysis;
		const changes = Object.values(analysis.nodes).filter((node) => node.kind);
		const all = totals(changes);
		const visible = totals(changes.filter((node) => node.effectiveEmphasis.value !== "hidden"));
		await summary(page, "All workspace changes", all.files, all.removed, all.added);
		await summary(page, "Visible workspace changes", visible.files, visible.removed, visible.added);
		assert.equal(analysis.nodes["app/tests/check.test.ts"]?.classification.value, "tests");
		assert.equal(analysis.nodes["app/tests/check.test.ts"]?.effectiveEmphasis.value, "deemphasized");
		assert.equal(analysis.nodes["app/tests/critical.txt"]?.effectiveEmphasis.value, "normal");
		assert.equal(analysis.nodes["app/tracked.txt"]?.effectiveEmphasis.value, "emphasized");
		assert.equal(analysis.nodes["app/hidden.txt"]?.effectiveEmphasis.value, "hidden");
		assert.deepEqual(sourceState(workspace), edited);
		await waitSelected(page, "nested");
		assert.equal(
			await select(page, "nested").getAttribute("aria-pressed"),
			"true",
			"Repository placeholder upgrades without changing selection",
		);

		await select(page, "nested/browser-binary.dat").click();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText("Binary change. Line totals are unavailable.", { exact: true })
			.waitFor();

		await page.getByRole("button", { name: "Deselect all types and importance levels", exact: true }).click();
		await summary(page, "Visible workspace changes", 0, 0, 0);
		await select(page, "not-cloned").waitFor();
		await select(page, "nested").waitFor();
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await page.getByRole("button", { name: "High", exact: true }).click();
		await summary(page, "Visible workspace changes", 1, 1, 2);
		await select(page, "app/tracked.txt").click();
		await waitSelected(page, "app/tracked.txt");
		await page.getByRole("button", { name: "High", exact: true }).click();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/outside the current filters/i)
			.waitFor();
		assert.equal(new URL(page.url()).searchParams.get("path"), "app/tracked.txt");
		await page.getByRole("button", { name: "None", exact: true }).click();
		await select(page, "app/hidden.txt").click();
		await waitSelected(page, "app/hidden.txt");
		await page.getByRole("button", { name: "Select all types and importance levels", exact: true }).click();
		await summary(page, "Visible workspace changes", all.files, all.removed, all.added);
		await select(page, "other/renamed.txt").click();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByRole("paragraph")
			.filter({ hasText: "Renamed from app/old.txt" })
			.waitFor();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/fixture-app/)
			.waitFor();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/fixture-other/)
			.waitFor();
		await page
			.getByRole("button", { name: /base codebase boundary:.*app/ })
			.first()
			.waitFor();
		await page
			.getByRole("button", { name: /current codebase boundary:.*other/ })
			.first()
			.waitFor();
		const transition = row(page, "app/transition");
		assert.equal(await transition.count(), 1, "Changed directory transition has one canonical row");
		assert.ok(analysis.nodes["app/transition"]?.kind);
		assert.ok(analysis.nodes["app/transition"]?.children.length);

		await select(page, unusual).click();
		await waitSelected(page, unusual);
		await select(page, unusual).click({ modifiers: ["Control"] });
		await waitSelected(page, unusual);
		await page
			.getByRole("status")
			.filter({ hasText: `Copied: ${unusual}` })
			.waitFor();
		assert.equal(
			await page
				.locator("body")
				.evaluate((element) => element.ownerDocument.defaultView.navigator.clipboard.readText()),
			unusual,
		);
		await page.locator("body").evaluate((element) =>
			Object.defineProperty(element.ownerDocument.defaultView.navigator.clipboard, "writeText", {
				configurable: true,
				value: async () => {
					throw new Error("Clipboard fixture unavailable");
				},
			}),
		);
		await select(page, unusual).click({ modifiers: ["Control"] });
		await page.getByRole("status").filter({ hasText: "Could not copy path" }).waitFor();
		await waitSelected(page, unusual);
		await page
			.locator("body")
			.evaluate((element) =>
				Reflect.deleteProperty(element.ownerDocument.defaultView.navigator.clipboard, "writeText"),
			);
		await settled(page);
		await page.reload();
		await waitSelected(page, unusual);
		await select(page, unusual).click();
		await waitSelected(page);
		await settled(page);
		await page.goBack();
		await waitSelected(page, unusual);
		await settled(page);
		await page.goForward();
		await waitSelected(page);
		await settled(page);
		await page.goto(`${address}/?path=${encodeURIComponent(".")}`);
		await waitSelected(page, ".");
		await select(page, ".").waitFor();
		await select(page, ".").click({ modifiers: ["Control"] });
		await page.getByRole("status").filter({ hasText: "Copied: ." }).waitFor();
		assert.equal(
			await page
				.locator("body")
				.evaluate((element) => element.ownerDocument.defaultView.navigator.clipboard.readText()),
			".",
		);
		await settled(page);
		await page.goto(`${address}/?path=${encodeURIComponent("nested")}`);
		await waitSelected(page, "nested");
		await settled(page);
		await page.goto(`${address}/?path=${encodeURIComponent("not-cloned")}`);
		await waitSelected(page, "not-cloned");
		await settled(page);
		await page.goto(`${address}/?path=${encodeURIComponent(unusual)}`);
		await waitSelected(page, unusual);
		await page.getByRole("button", { name: "Select all types and importance levels", exact: true }).click();

		await page.getByRole("button", { name: "Collapse app/bulk", exact: true }).click();
		assert.equal(new URL(page.url()).searchParams.get("path"), unusual, "Disclosure preserves selection");
		await refresh.click();
		await page.getByRole("button", { name: "Expand app/bulk", exact: true }).waitFor();
		await page.getByRole("button", { name: "Expand app/bulk", exact: true }).click();
		const summaryColumns = await page
			.getByRole("button", { name: /^Visible workspace changes:/ })
			.locator(":scope > span")
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
		const rootColumns = await page
			.getByRole("button", { name: /^\. repository changes:/ })
			.locator(":scope > span")
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
		assert.deepEqual(rootColumns, summaryColumns, "Removal/addition columns align with the sidebar summary");
		const sidebar = page.getByTestId("changes-scroll");
		const detail = page.getByTestId("selection-scroll");
		await sidebar.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		assert.ok(await sidebar.evaluate((element) => element.scrollTop > 0), "Substantial tree scrolls in its pane");
		assert.equal(await page.locator("html").evaluate((element) => element.scrollTop), 0);
		const detailTop = await detail.evaluate((element) => element.scrollTop);
		await sidebar.evaluate((element) => {
			element.scrollTop = 0;
		});
		assert.equal(
			await detail.evaluate((element) => element.scrollTop),
			detailTop,
			"Sidebar scrolling leaves detail scroll unchanged",
		);
		const separator = page.getByRole("separator", { name: "Resize changes sidebar" });
		await separator.focus();
		const initialWidth = Number(await separator.getAttribute("aria-valuenow"));
		await separator.press("ArrowRight");
		assert.ok(Number(await separator.getAttribute("aria-valuenow")) > initialWidth);
		await separator.press("ArrowLeft");
		assert.equal(Number(await separator.getAttribute("aria-valuenow")), initialWidth);
		const bounds = await separator.boundingBox();
		assert.ok(bounds);
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
		await page.mouse.down();
		await page.mouse.move(bounds.x + 50, bounds.y + 100);
		await page.mouse.up();
		assert.ok(Number(await separator.getAttribute("aria-valuenow")) > initialWidth);
		const header = await page.locator("header[data-workspace-header] > :first-child").boundingBox();
		assert.ok(header);
		const bodyDivider = await separator.boundingBox();
		assert.ok(bodyDivider);
		assert.ok(Math.abs(header.x + header.width - bodyDivider.x) < 3, "Header identity ends at the body divider");
		const sharedWidth = await page
			.locator("main")
			.evaluate((element) =>
				element.ownerDocument.defaultView.getComputedStyle(element).getPropertyValue("--sidebar-width"),
			);
		assert.ok(Math.abs(bodyDivider.x - Number.parseFloat(sharedWidth)) < 3, "Header and body use one sidebar width");
		await expectPortal(page, page.getByRole("button", { name: /^All workspace changes:/ }));
		await expectPortal(page, page.getByRole("button", { name: "Keyboard help", exact: true }));
		await page.screenshot({ path: join(screenshots, "normal.png") });
		await page.setViewportSize({ width: 360, height: 740 });
		const width = await page
			.locator("body")
			.evaluate((element) => ({ scroll: element.scrollWidth, viewport: element.ownerDocument.defaultView.innerWidth }));
		assert.ok(width.scroll <= width.viewport, "Navigator bounds long paths at narrow widths");
		assert.equal(
			await page
				.getByRole("heading", { name: workspaceName, exact: true })
				.evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).fontSize),
			"20px",
		);
		await page.screenshot({ path: join(screenshots, "narrow.png") });
		await page.setViewportSize({ width: 1100, height: 800 });
		await settled(page);
		await page.goto(`${address}/?path=${encodeURIComponent("app/tracked.txt")}`);
		await waitSelected(page, "app/tracked.txt");
		renameSync(nested, suspended);
		moved = true;
		await refresh.click();
		await page.getByRole("alert").filter({ hasText: "Change summary is stale." }).waitFor();
		await summary(page, "All workspace changes", all.files, all.removed, all.added);
		assert.equal(new URL(page.url()).searchParams.get("path"), "app/tracked.txt");
		renameSync(suspended, nested);
		moved = false;
		writeFileSync(tracked, original);
		await page.getByRole("button", { name: "Retry changes", exact: true }).click();
		await page.getByText(/selection.*unavailable|selected.*disappeared/i).waitFor();
		await waitSelected(page);
		await select(page, "nested").click();
		rmSync(join(workspace, "nested/browser-binary.dat"), { force: true });
		await refresh.click();
		await waitSelected(page, "nested");
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/No changed entries/i)
			.waitFor();
		assert.equal(await page.getByRole("alert").count(), 0);
		assert.ok(
			assets.some((path) => path.endsWith(".woff2")),
			"Bundled font must load",
		);
		assert.ok(
			assets.some((path) => path.endsWith(".svg")),
			"Bundled icons/emblem must load",
		);
		assert.ok(assetResponses.length > 0);
		for (const asset of assetResponses) {
			assert.equal(asset.status, 200, `Asset failed: ${asset.path}`);
			if (asset.path.endsWith(".svg")) assert.match(asset.type, /image\/svg\+xml/);
			if (asset.path.endsWith(".woff2")) assert.match(asset.type, /font\/woff2/);
		}
		assert.equal(
			await page
				.locator("img")
				.evaluateAll((elements) =>
					elements.every(
						(element) =>
							"naturalWidth" in element && typeof element.naturalWidth === "number" && element.naturalWidth > 0,
					),
				),
			true,
			"Delivered emblem and image icons must decode",
		);
		await page.locator("body").evaluate((element) => element.ownerDocument.fonts.ready);
		assert.equal(
			await page.locator("body").evaluate((element) => element.ownerDocument.fonts.check('13px "JetBrains Mono"')),
			true,
			"Bundled JetBrains Mono must load successfully",
		);
		assert.ok(apiRequests.includes("/api/workspace") && apiRequests.includes("/api/changes/analysis"));
		assert.ok(
			apiRequests.every((path) => path === "/api/workspace" || path === "/api/changes/analysis"),
			apiRequests.join(", "),
		);
		assert.deepEqual(pageErrors, []);
		assert.deepEqual(consoleErrors, []);
		assert.deepEqual(failedRequests, []);
		console.log(
			`Installed Chromium navigator: real guide policies, filters/counts, repository placeholders, ownership/rename/transition, encoded direct loads/history, fresh/stale recovery, portal tooltips, local assets and resize/scroll/narrow layout passed. Screenshots: ${screenshots}`,
		);
	} finally {
		try {
			if (moved) renameSync(suspended, nested);
			for (const target of created) rmSync(target, { force: true });
			if (transitioned) {
				rmSync(join(workspace, "app/transition"), { recursive: true, force: true });
				writeFileSync(join(workspace, "app/transition"), originalTransition);
			}
			if (renamed) renameSync(join(workspace, "other/renamed.txt"), join(workspace, "app/old.txt"));
			writeFileSync(join(workspace, ".git/index"), index);
			writeFileSync(tracked, original);
		} finally {
			await browser.close();
		}
	}
}
