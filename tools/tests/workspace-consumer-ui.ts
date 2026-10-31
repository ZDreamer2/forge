import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

type Deps = {
	address: string;
	workspace: string;
	workspaceName: string;
	sourceState: (workspace: string) => unknown;
};

async function summary(page: Page, label: string, value: number) {
	const result = page.getByText(label, { exact: true }).locator("..").locator("dd");
	await result.filter({ hasText: new RegExp(`^${value}$`) }).waitFor();
	assert.equal(await result.textContent(), String(value), label);
}

export async function verifyInstalledUi({ address, workspace, workspaceName, sourceState }: Deps) {
	const tracked = join(workspace, "app/tracked.txt");
	const original = readFileSync(tracked);
	const nested = join(workspace, "nested");
	const suspended = `${workspace}-suspended-repository`;
	let moved = false;
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
		page.setDefaultTimeout(10_000);
		const pageErrors: string[] = [];
		const consoleErrors: string[] = [];
		const apiRequests: string[] = [];
		const failedRequests: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && !/the server responded with a status of 500/.test(message.text())) {
				consoleErrors.push(message.text());
			}
		});
		page.on("requestfailed", (request) => failedRequests.push(request.url()));
		page.on("request", (request) => {
			const path = new URL(request.url()).pathname;
			if (path.startsWith("/api/")) apiRequests.push(path);
		});
		const before = sourceState(workspace);
		const response = await page.goto(address);
		assert.equal(response?.status(), 200);
		await page.getByRole("heading", { name: workspaceName, exact: true }).waitFor();
		await page.getByText("not-cloned: Missing", { exact: true }).waitFor();
		await summary(page, "Changed entries", 0);
		await summary(page, "All-change additions", 0);
		await summary(page, "All-change removals", 0);
		assert.deepEqual(sourceState(workspace), before);
		assert.equal(await page.locator("html").getAttribute("data-mantine-color-scheme"), "light");
		const layout = await page
			.locator("main")
			.evaluate<{ display: string; maxWidth: string; margin: string }>((element) => ({
				display: element.ownerDocument.defaultView.getComputedStyle(element).display,
				maxWidth: element.ownerDocument.defaultView.getComputedStyle(element).maxWidth,
				margin: element.ownerDocument.defaultView.getComputedStyle(element.ownerDocument.body).margin,
			}));
		assert.equal(layout.display, "grid", "CSS-module layout must reach the installed app");
		assert.notEqual(layout.maxWidth, "none");
		assert.equal(layout.margin, "0px");
		const button = page.getByRole("button", { name: "Refresh", exact: true });
		const buttonStyle = await button.evaluate<{ background: string; height: number }>((element) => ({
			background: element.ownerDocument.defaultView.getComputedStyle(element).backgroundColor,
			height: element.getBoundingClientRect().height,
		}));
		assert.notEqual(buttonStyle.background, "rgba(0, 0, 0, 0)", "Mantine button styles must be delivered");
		assert.ok(buttonStyle.height >= 30);

		writeFileSync(tracked, "browser refresh\nsecond line\n");
		const edited = sourceState(workspace);
		await button.click();
		await summary(page, "Changed entries", 1);
		await summary(page, "All-change additions", 2);
		await summary(page, "All-change removals", 1);
		await summary(page, "Attention additions", 2);
		await summary(page, "Attention removals", 1);
		assert.deepEqual(sourceState(workspace), edited);

		renameSync(nested, suspended);
		moved = true;
		await button.click();
		await page
			.getByRole("alert")
			.filter({ hasText: "Change summary is stale. Could not load change summary." })
			.waitFor();
		await summary(page, "Changed entries", 1);
		assert.equal(await button.isEnabled(), true);
		renameSync(suspended, nested);
		moved = false;
		assert.deepEqual(sourceState(workspace), edited);
		writeFileSync(tracked, original);
		const restored = sourceState(workspace);
		await page.getByRole("button", { name: "Retry changes", exact: true }).click();
		await summary(page, "Changed entries", 0);
		await page.getByText("No changed entries.", { exact: true }).waitFor();
		assert.equal(await page.getByRole("alert").count(), 0);
		assert.deepEqual(sourceState(workspace), restored);
		await page.reload();
		await summary(page, "Changed entries", 0);
		await page.setViewportSize({ width: 360, height: 740 });
		const width = await page.locator("body").evaluate<{ scroll: number; viewport: number }>((element) => ({
			scroll: element.scrollWidth,
			viewport: element.ownerDocument.defaultView.innerWidth,
		}));
		assert.ok(width.scroll <= width.viewport, "Overview must fit a narrow viewport");
		assert.deepEqual(sourceState(workspace), restored);
		assert.ok(apiRequests.includes("/api/workspace") && apiRequests.includes("/api/changes/analysis"));
		assert.ok(
			apiRequests.every((path) => path === "/api/workspace" || path === "/api/changes/analysis"),
			apiRequests.join(", "),
		);
		assert.deepEqual(pageErrors, []);
		assert.deepEqual(consoleErrors, []);
		assert.deepEqual(failedRequests, []);
		console.log(
			"Installed Chromium: boot, Mantine/module styles, literal identity, canonical totals, fresh Refresh, repository-loss stale state, retry and narrow layout passed.",
		);
	} finally {
		try {
			if (moved) renameSync(suspended, nested);
			writeFileSync(tracked, original);
		} finally {
			await browser.close();
		}
	}
}
