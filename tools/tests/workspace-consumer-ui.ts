import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { AnalysisWireNode, WorkspaceAnalysis } from "../../server/src/components/api-contract/index.ts";
import { verifyInstalledDiffs } from "./workspace-consumer-ui-diffs.ts";

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

function inspect(page: Page, path: string, severity: "warnings" | "notices") {
	return row(page, path).getByRole("button", { name: `Inspect ${severity} for ${path}`, exact: true });
}

function signalDetails(page: Page) {
	return page.getByRole("region", { name: "Signal details", exact: true });
}

async function summary(page: Page, label: string, files: number, removed: number, added: number) {
	await page
		.getByLabel(`${label}: ${files} changed files, ${removed} removed lines, ${added} added lines`, { exact: true })
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
	const viewer = page.getByRole("region", { name: "Selection details", exact: true });
	await viewer.getByRole("heading", { name: path ?? "Workspace changes", exact: true }).waitFor();
}

async function settled(page: Page) {
	await page.getByRole("button", { name: "Refresh", exact: true }).and(page.locator(":enabled")).waitFor();
}

async function refreshAnalysis(page: Page): Promise<WorkspaceAnalysis> {
	await settled(page);
	// Arm both reads before the click: an unchanged summary or collapsed row
	// cannot acknowledge a new Refresh. Callers still assert the resulting UI.
	const workspace = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workspace");
	const analysis = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/changes/analysis");
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	const [workspaceResponse, analysisResponse] = await Promise.all([workspace, analysis]);
	assert.equal(workspaceResponse.status(), 200);
	assert.equal(analysisResponse.status(), 200);
	await workspaceResponse.finished();
	const facts = (await analysisResponse.json()) as WorkspaceAnalysis;
	await settled(page);
	return facts;
}

async function expectPortal(page: Page, trigger: Locator, inspectTooltip?: (tooltip: Locator) => Promise<void>) {
	await trigger.hover();
	await trigger.and(page.locator("[aria-describedby]")).waitFor();
	const tooltipId = await trigger.getAttribute("aria-describedby");
	const tooltip = page.locator(`[role="tooltip"][id=${JSON.stringify(tooltipId)}]`);
	await tooltip.waitFor();
	const deadline = Date.now() + 30_000;
	while (
		(await tooltip.evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).opacity)) !== "1"
	) {
		assert.ok(Date.now() < deadline, "Tooltip must reach its final opacity");
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.equal(
		await tooltip.evaluate((element) => !element.closest("main")),
		true,
		"Production tooltips must use their portal",
	);
	assert.equal(
		await tooltip.evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).backgroundColor),
		"rgb(255, 255, 255)",
	);
	await inspectTooltip?.(tooltip);
	await page.mouse.move(1090, 1);
	await tooltip.waitFor({ state: "hidden" });
	// Mantine opens focus tooltips for keyboard-visible focus.
	await page.keyboard.press("Tab");
	await trigger.focus();
	await tooltip.waitFor();
	await trigger.blur();
	await tooltip.waitFor({ state: "hidden" });
}

async function expectNoTooltip(page: Page, target: Locator, focusable = false) {
	await target.hover();
	// Cross Mantine's hover delay and transition before observing absence.
	await page.waitForTimeout(400);
	assert.equal(await page.getByRole("tooltip").count(), 0, "Names and change counters have no hover tooltip");
	assert.equal(await target.getAttribute("aria-describedby"), null);
	if (focusable) {
		await page.keyboard.press("Tab");
		await target.focus();
		await page.waitForTimeout(400);
		assert.equal(await page.getByRole("tooltip").count(), 0, "Tree names have no focus tooltip");
		await target.blur();
	} else {
		assert.equal(await target.evaluate((element) => element.matches("button, [tabindex]")), false);
	}
	await page.mouse.move(1090, 1);
}

async function matrix(page: Page, nodes: AnalysisWireNode[]) {
	const table = page.getByRole("table", { name: "Matching changes by type and importance", exact: true });
	await table.waitFor();
	const types = ["code", "tests", "docs", "config", "assets"];
	const importance = ["emphasized", "normal", "deemphasized", "hidden"];
	const labels: Record<string, string> = {
		code: "Code",
		tests: "Tests",
		docs: "Docs",
		config: "Config",
		assets: "Assets",
		emphasized: "High",
		normal: "Medium",
		deemphasized: "Low",
		hidden: "None",
	};
	const columns = importance.filter((key) => nodes.some((node) => node.effectiveEmphasis.value === key));
	for (const key of importance)
		assert.equal(
			await table.getByRole("columnheader", { name: labels[key], exact: true }).count(),
			columns.includes(key) ? 1 : 0,
		);
	for (const type of ["all", ...types]) {
		const matching = type === "all" ? nodes : nodes.filter((node) => node.classification.value === type);
		const heading = table.getByRole("rowheader", { name: type === "all" ? "All" : labels[type], exact: true });
		assert.equal(await heading.count(), matching.length ? 1 : 0);
		if (!matching.length) continue;
		const cells = heading.locator("..").getByRole("cell");
		for (const [index, column] of ["all", ...columns].entries()) {
			const entries = column === "all" ? matching : matching.filter((node) => node.effectiveEmphasis.value === column);
			const expected = totals(entries);
			assert.equal(
				(await cells.nth(index).innerText()).replace(/\s/g, ""),
				expected.files ? `${expected.files}/+${expected.added}/−${expected.removed}` : "—",
			);
		}
	}
	assert.equal(await table.getByRole("button").count(), 0, "Matrix labels are informational");
	assert.ok(
		await table.evaluate((element) =>
			[...element.querySelectorAll("td > span[aria-label$='removed lines']")].every(
				(cell) => cell.ownerDocument.defaultView.getComputedStyle(cell).whiteSpace === "nowrap",
			),
		),
		"Matrix values remain on one line",
	);
}

async function treeGeometry(page: Page) {
	const icon = (path: string) => row(page, path).locator(":scope > img, :scope > span[aria-hidden=true]").first();
	const root = await icon(".").boundingBox();
	const folder = await icon("app/Tests").boundingBox();
	const file = await icon("app/tracked.txt").boundingBox();
	const app = await icon("app").boundingBox();
	assert.ok(root && app && folder && file);
	assert.equal(root.x, 19, "Root icon starts 19px from the sidebar edge");
	assert.equal(app.x - root.x, 17, "Each tree depth uses one 17px icon step");
	assert.equal(folder.x, file.x, "Same-depth file and folder icons align");
	assert.equal(folder.x - app.x, 17);
	const folderName = await select(page, "app/Tests").boundingBox();
	const fileName = await select(page, "app/tracked.txt").boundingBox();
	assert.ok(folderName && fileName);
	assert.equal(folderName.x, fileName.x, "Same-depth file and folder names align");
	assert.equal(folderName.x - (folder.x + folder.width), 3, "Icon/name gap is compact");
	assert.equal((await row(page, "app").boundingBox())?.height, 25);
	const disclosure = await page.getByRole("button", { name: "Collapse app", exact: true }).boundingBox();
	assert.ok(disclosure && disclosure.x + disclosure.width <= app.x, "Disclosure stays in the icon's left gutter");
}

export async function verifyInstalledUi({ address, workspace, workspaceName, sourceState, run }: Deps) {
	const tracked = join(workspace, "app/tracked.txt");
	const original = readFileSync(tracked);
	const originalTransition = readFileSync(join(workspace, "app/transition"));
	const index = readFileSync(join(workspace, ".git/index"));
	const nested = join(workspace, "nested");
	const suspended = `${workspace}-suspended-repository`;
	const created = new Set<string>();
	const unusual = `app/deep/${"long-directory-".repeat(7)}/Unicode café # % ? \\ file.ts`;
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
		const rejectedFilePaths: string[] = [];
		const apiRequests: string[] = [];
		const assets: string[] = [];
		const assetResponses: { path: string; status: number; type: string }[] = [];
		const failedRequests: { url: string; error?: string }[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && /status of 400/.test(message.text())) {
				const rejected = new URL(message.location().url);
				if (rejected.pathname === "/api/changes/file" && rejected.searchParams.get("path") === unusual) return;
			}
			if (message.type() === "error" && !/the server responded with a status of 500/.test(message.text()))
				consoleErrors.push(message.text());
		});
		page.on("requestfailed", (request) =>
			failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
		);
		page.on("response", (response) => {
			const url = new URL(response.url());
			const path = url.pathname;
			if (response.status() === 400) {
				assert.equal(path, "/api/changes/file");
				assert.equal(url.searchParams.get("path"), unusual);
				assert.equal(url.searchParams.get("context"), "3");
				rejectedFilePaths.push(url.searchParams.get("path") ?? "");
			}
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
		assert.equal(await select(page, "not-cloned").count(), 0, "Missing repositories have no analyzed tree row");
		await page.goto(`${address}/?path=not-cloned`);
		await waitSelected(page, "not-cloned");
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/Missing at startup/i)
			.waitFor();
		assert.equal(await select(page, "nested").count(), 0, "Known-empty repositories are omitted");
		assert.equal(await page.getByText("No changed entries.", { exact: true }).count(), 0);
		await page.goto(`${address}/?path=nested`);
		await page.getByRole("heading", { name: "nested", exact: true }).waitFor();
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
		write("app/Tests/low/only.test.ts", "low subtree content\n");
		write("app/tests/critical.txt", "restored normal\n");
		write("app/settings.json", "{}\n");
		write("app/readme.md", "browser docs\n");
		write("app/logo.svg", "<svg/>\n");
		write(unusual, "encoded browser path\n");
		for (let i = 0; i < 100; i++) write(`app/bulk/file-${String(i).padStart(3, "0")}.ts`, `bulk ${i}\n`);
		const edited = sourceState(workspace);
		const refresh = page.getByRole("button", { name: "Refresh", exact: true });
		const analysis = await refreshAnalysis(page);
		const changes = Object.values(analysis.nodes).filter((node) => node.kind);
		const all = totals(changes);
		const visible = totals(changes.filter((node) => node.effectiveEmphasis.value !== "hidden"));
		await summary(page, "All workspace changes", all.files, all.removed, all.added);
		const initiallyShown = totals(
			changes.filter((node) => node.effectiveEmphasis.value !== "hidden" && !node.path.startsWith("app/Tests/")),
		);
		await summary(page, "Shown changes", initiallyShown.files, initiallyShown.removed, initiallyShown.added);
		await page.getByRole("button", { name: "Expand app/Tests", exact: true }).waitFor();
		assert.equal(await select(page, "app/Tests/low/only.test.ts").count(), 0, "Low matching branches start collapsed");
		await summary(page, ". visible subtree", visible.files, visible.removed, visible.added);
		await page.getByRole("heading", { name: `Changes ${visible.files} of ${all.files}`, exact: true }).waitFor();
		await expectPortal(page, page.getByRole("button", { name: "Shown", exact: true }), async (tooltip) => {
			await tooltip
				.getByText(
					"Matching files outside collapsed folders. Collapsed descendants are excluded; scrolling does not affect this total.",
					{ exact: true },
				)
				.waitFor();
		});
		await page.getByRole("button", { name: "Collapse all", exact: true }).click();
		await summary(page, "Shown changes", 0, 0, 0);
		await summary(page, ". visible subtree", visible.files, visible.removed, visible.added);
		await summary(page, "All workspace changes", all.files, all.removed, all.added);
		await page.getByRole("button", { name: "Expand .", exact: true }).click();
		await page.getByRole("button", { name: "Expand app", exact: true }).waitFor();
		await page.getByRole("button", { name: "Expand all", exact: true }).click();
		await select(page, "app/Tests/low/only.test.ts").waitFor();
		await summary(page, "Shown changes", visible.files, visible.removed, visible.added);
		const withoutTransitionChildren = totals(
			changes.filter((node) => node.effectiveEmphasis.value !== "hidden" && !node.path.startsWith("app/transition/")),
		);
		assert.ok(analysis.nodes["app/transition"]?.kind, "Transition has an own change and children");
		await page.getByRole("button", { name: "Collapse app/transition", exact: true }).click();
		await summary(
			page,
			"Shown changes",
			withoutTransitionChildren.files,
			withoutTransitionChildren.removed,
			withoutTransitionChildren.added,
		);
		await page.getByRole("button", { name: "Expand app/transition", exact: true }).click();
		await summary(page, "Shown changes", visible.files, visible.removed, visible.added);
		assert.equal(await select(page, ".").innerText(), workspaceName);
		assert.equal(analysis.nodes["app/tests/check.test.ts"]?.classification.value, "tests");
		await page.getByRole("button", { name: "Tests", exact: true }).click();
		assert.equal(await select(page, "app/tests/check.test.ts").count(), 0);
		assert.equal(await select(page, "app/tests").count(), 0, "Last matching Tests descendant prunes its ancestor");
		await select(page, "app/tracked.txt").waitFor();
		await summary(page, "All workspace changes", all.files, all.removed, all.added);
		await page.getByRole("button", { name: "Tests", exact: true }).click();
		await select(page, "app/tests/check.test.ts").waitFor();
		assert.equal(analysis.nodes["app/tests/check.test.ts"]?.effectiveEmphasis.value, "deemphasized");
		assert.equal(analysis.nodes["app/tests/critical.txt"]?.effectiveEmphasis.value, "normal");
		assert.equal(analysis.nodes["app/tracked.txt"]?.effectiveEmphasis.value, "emphasized");
		assert.equal(analysis.nodes["app/hidden.txt"]?.effectiveEmphasis.value, "hidden");
		assert.deepEqual(analysis.nodes.nested?.signalCounts, { notice: 1, warning: 1 });
		assert.deepEqual(
			analysis.nodes.nested?.signals.map(({ severity, message }) => ({ severity, message })),
			[{ severity: "notice", message: "Nested repository notice" }],
		);
		assert.deepEqual(analysis.nodes["app/hidden.txt"]?.signals[0]?.location, { side: "current", line: 1, column: 2 });
		assert.deepEqual(analysis.nodes["other/renamed.txt"]?.signals[0]?.location, { side: "base", line: 1, column: 3 });
		assert.equal(analysis.nodes.app?.signals[0]?.message, "Direct folder notice");
		assert.deepEqual(sourceState(workspace), edited);
		await waitSelected(page, "nested");
		assert.equal(
			await select(page, "nested").getAttribute("aria-pressed"),
			"true",
			"Repository placeholder upgrades without changing selection",
		);

		const nestedChanges = changes.filter((node) => node.path.startsWith("nested/"));
		await matrix(page, nestedChanges);
		await page
			.getByRole("region", { name: "Matching subtree summary" })
			.getByText(/No line changes/)
			.waitFor();
		await page.screenshot({ path: join(screenshots, "matrix-zero-lines.png") });
		await page.getByRole("button", { name: "Deselect all types and importance levels", exact: true }).click();
		await page
			.getByRole("region", { name: "Matching subtree summary" })
			.getByText(/No changes match the current filters/)
			.waitFor();
		assert.equal(await page.getByRole("table", { name: "Matching changes by type and importance" }).count(), 0);
		await page
			.getByRole("region", { name: "Matching subtree summary" })
			.getByRole("heading", { name: /0 matching changed files.*of 1/ })
			.waitFor();
		await page.screenshot({ path: join(screenshots, "matrix-filtered-out.png") });
		await page.getByRole("button", { name: "Select all types and importance levels", exact: true }).click();

		await select(page, "nested/browser-binary.dat").click();
		await page.getByText("Entry metadata", { exact: true }).click();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText("Binary change. Line totals are unavailable.", { exact: true })
			.waitFor();

		await page.getByRole("button", { name: "Deselect all types and importance levels", exact: true }).click();
		await summary(page, "Shown changes", 0, 0, 0);
		assert.equal(await select(page, ".").count(), 0, "No matching changes prunes the whole tree");
		assert.equal(await select(page, "not-cloned").count(), 0);
		assert.equal(await select(page, "nested").count(), 0);
		await page
			.getByRole("navigation", { name: "Changed files" })
			.getByText("No changes match the filters", { exact: true })
			.waitFor();
		await page.getByRole("button", { name: "Select all types and importance levels", exact: true }).click();
		await select(page, "nested").waitFor();
		assert.equal(
			await inspect(page, "nested", "warnings").evaluate(
				(element) => element.ownerDocument.defaultView.getComputedStyle(element).opacity,
			),
			"0.4",
			"Direct notice must not strengthen a descendant-only warning",
		);
		assert.equal(
			await inspect(page, "nested", "notices").evaluate(
				(element) => element.ownerDocument.defaultView.getComputedStyle(element).opacity,
			),
			"1",
		);
		await expectPortal(page, inspect(page, "nested", "warnings"), async (tooltip) => {
			await tooltip.getByText("Nested repository notice", { exact: true }).waitFor();
			await tooltip.getByText("Nested descendant warning", { exact: true }).waitFor();
			await tooltip.getByText("nested/", { exact: true }).waitFor();
			assert.equal(await tooltip.getByText("Severity", { exact: true }).count(), 0);
			await page.screenshot({ path: join(screenshots, "signal-tooltip.png") });
		});
		await inspect(page, "nested", "warnings").click();
		await page.waitForURL((url) => url.searchParams.get("path") === "nested");
		await signalDetails(page).getByText("Nested repository notice", { exact: true }).waitFor();
		await page.getByRole("tooltip", { name: "Signals for nested", exact: true }).waitFor({ state: "hidden" });
		await signalDetails(page).getByText("Nested descendant warning", { exact: true }).waitFor();
		await signalDetails(page)
			.getByRole("button", { name: "Inspect source nested/browser-binary.dat", exact: true })
			.click();
		await page.waitForURL((url) => url.searchParams.get("path") === "nested/browser-binary.dat");
		await page.getByRole("button", { name: "Deselect all types and importance levels", exact: true }).click();
		await summary(page, "Shown changes", 0, 0, 0);
		await signalDetails(page)
			.getByText(/filtered out/i)
			.waitFor();
		await signalDetails(page)
			.getByRole("button", { name: "Reveal file nested/browser-binary.dat", exact: true })
			.click();
		await select(page, "nested/browser-binary.dat").waitFor();
		await page.getByRole("button", { name: "Hide signal details", exact: true }).click();
		await inspect(page, "nested/browser-binary.dat", "warnings").click();
		await signalDetails(page).getByText("Nested descendant warning", { exact: true }).waitFor();
		await page.goBack();
		await waitSelected(page, "nested");
		await page.getByRole("button", { name: "Show signal details", exact: true }).waitFor();
		await page.goForward();
		await waitSelected(page, "nested/browser-binary.dat");
		await page.getByRole("button", { name: "Show signal details", exact: true }).waitFor();
		await page.getByRole("button", { name: "Deselect all types and importance levels", exact: true }).click();
		await page.getByRole("button", { name: "Code", exact: true }).click();
		await page.getByRole("button", { name: "High", exact: true }).click();
		await summary(page, "Shown changes", 1, 1, 2);
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
		await summary(page, "Shown changes", all.files, all.removed, all.added);
		await page.getByRole("button", { name: "Collapse app/bulk", exact: true }).click();
		await inspect(page, ".", "warnings").click();
		await signalDetails(page).getByText("Nested descendant warning", { exact: true }).waitFor();
		await signalDetails(page).getByText("Direct folder notice", { exact: true }).waitFor();
		await signalDetails(page).getByRole("button", { name: "Inspect source app", exact: true }).waitFor();
		const signals = signalDetails(page);
		const headerBeforeScroll = await page
			.getByRole("region", { name: "Selection details", exact: true })
			.getByRole("heading", { level: 2 })
			.boundingBox();
		await signals.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		assert.ok(
			await signals.evaluate((element) => element.scrollTop > 0),
			"Complete signal details have bounded scrolling",
		);
		assert.deepEqual(
			await page
				.getByRole("region", { name: "Selection details", exact: true })
				.getByRole("heading", { level: 2 })
				.boundingBox(),
			headerBeforeScroll,
			"Scrolling messages preserves the selected-path header",
		);
		await signals.evaluate((element) => {
			element.scrollTop = 0;
		});
		await page.screenshot({ path: join(screenshots, "signal-details.png") });
		await signals.getByText(/^Long source message/).scrollIntoViewIfNeeded();
		await page.screenshot({ path: join(screenshots, "signal-details-long.png") });
		await page.setViewportSize({ width: 360, height: 800 });
		await signals.getByText(/^Long source message/).scrollIntoViewIfNeeded();
		assert.ok(
			await page.locator("body").evaluate((element) => element.scrollWidth <= 360),
			"Long signal content stays within the narrow viewport",
		);
		await page.screenshot({ path: join(screenshots, "signal-details-narrow.png") });
		await page.setViewportSize({ width: 1100, height: 800 });
		await signalDetails(page).getByRole("button", { name: "Inspect source app/hidden.txt", exact: true }).click();
		await waitSelected(page, "app/hidden.txt");
		await page.getByRole("button", { name: "None", exact: true }).click();
		await signalDetails(page).getByRole("button", { name: "Reveal file app/hidden.txt", exact: true }).click();
		await select(page, "app/hidden.txt").waitFor();
		await page.getByRole("button", { name: "Expand app/bulk", exact: true }).waitFor();
		await signalDetails(page)
			.getByText(/current.*1.*2/i)
			.waitFor();
		await page.getByRole("button", { name: "Expand app/bulk", exact: true }).click();
		await select(page, "other/renamed.txt").click();
		await page.getByText("Entry metadata", { exact: true }).click();
		await page
			.getByRole("region", { name: "Selection details" })
			.getByRole("paragraph")
			.filter({ hasText: "Renamed from app/old.txt" })
			.waitFor();
		await inspect(page, "other/renamed.txt", "notices").click();
		await signalDetails(page).getByText("Renamed source notice", { exact: true }).waitFor();
		await signalDetails(page)
			.getByText(/base.*1.*3/i)
			.waitFor();
		await signalDetails(page).getByRole("button", { name: "Inspect source other/renamed.txt", exact: true }).waitFor();
		await page
			.getByRole("region", { name: "Selected entry metadata" })
			.getByText(/fixture-app/)
			.waitFor();
		await page
			.getByRole("region", { name: "Selected entry metadata" })
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
		await page
			.getByRole("region", { name: "File diff", exact: true })
			.getByRole("alert")
			.filter({ hasText: "Could not load file" })
			.waitFor();
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

		await matrix(
			page,
			changes.filter((node) => node.effectiveEmphasis.value !== "hidden"),
		);
		await page.getByRole("button", { name: "Select all types and importance levels", exact: true }).click();
		await matrix(page, changes);
		await page.screenshot({ path: join(screenshots, "matrix-all.png") });
		await page.setViewportSize({ width: 700, height: 800 });
		const matrixScroll = page.getByRole("table", { name: "Matching changes by type and importance" }).locator("..");
		assert.ok(
			await matrixScroll.evaluate(
				(element) =>
					element.scrollWidth > element.clientWidth &&
					element.ownerDocument.defaultView.getComputedStyle(element).overflowX === "auto",
			),
			"Narrow folder matrix scrolls locally",
		);
		assert.ok(
			await page.locator("body").evaluate((element) => element.scrollWidth <= 700),
			"Matrix does not widen the page",
		);
		await page.screenshot({ path: join(screenshots, "matrix-narrow.png") });
		await matrixScroll.evaluate((element) => {
			element.scrollLeft = element.scrollWidth;
		});
		assert.ok(
			await matrixScroll.evaluate((element) => element.scrollLeft > 0),
			"Last importance column remains reachable",
		);
		await page.setViewportSize({ width: 1100, height: 800 });
		await page.getByRole("button", { name: "None", exact: true }).click();
		await matrix(
			page,
			changes.filter((node) => node.effectiveEmphasis.value !== "hidden"),
		);

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
		await page.getByRole("button", { name: "Expand all", exact: true }).click();

		await page.getByRole("button", { name: "Collapse app/bulk", exact: true }).click();
		assert.equal(new URL(page.url()).searchParams.get("path"), unusual, "Disclosure preserves selection");
		await refreshAnalysis(page);
		await waitSelected(page, unusual);
		await page.getByRole("button", { name: "Expand app/bulk", exact: true }).waitFor();
		await page.getByRole("button", { name: "Expand app/bulk", exact: true }).click();
		const summaryColumns = await page
			.getByLabel(/^Shown changes:/)
			.locator(":scope > span")
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
		const rootColumns = await page
			.getByLabel(/^\. visible subtree:/)
			.locator(":scope > span")
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
		assert.deepEqual(rootColumns, summaryColumns, "Removal/addition columns align with the sidebar summary");
		const sidebar = page.getByTestId("changes-scroll");
		const detail = page.getByTestId("selection-scroll");
		await sidebar.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		assert.ok(await sidebar.evaluate((element) => element.scrollTop > 0), "Substantial tree scrolls in its pane");
		await summary(page, "Shown changes", all.files, all.removed, all.added);
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

		const preferredWidth = Number(await separator.getAttribute("aria-valuenow"));
		assert.equal(await page.evaluate(() => localStorage.getItem("forge-sidebar-width")), String(preferredWidth));
		await page.reload();
		await settled(page);
		assert.equal(
			Number(await separator.getAttribute("aria-valuenow")),
			preferredWidth,
			"Reload restores preferred sidebar width",
		);
		await page.setViewportSize({ width: 360, height: 740 });
		await page.waitForFunction(
			(element) => Number(element?.getAttribute("aria-valuenow")) < 300,
			await separator.elementHandle(),
		);
		assert.equal(
			await page.evaluate(() => localStorage.getItem("forge-sidebar-width")),
			String(preferredWidth),
			"Viewport clamp preserves saved preference",
		);
		await treeGeometry(page);
		await page.reload();
		await settled(page);
		assert.equal(
			await page.evaluate(() => localStorage.getItem("forge-sidebar-width")),
			String(preferredWidth),
			"Narrow reload does not overwrite preference",
		);
		await page.setViewportSize({ width: 1100, height: 800 });
		await page.waitForFunction(({ element, expected }) => Number(element?.getAttribute("aria-valuenow")) === expected, {
			element: await separator.elementHandle(),
			expected: preferredWidth,
		});
		await page.addInitScript(() => {
			if (sessionStorage.getItem("forge-test-block-storage") === "yes")
				Object.defineProperty(globalThis, "localStorage", {
					configurable: true,
					get() {
						throw new DOMException("Blocked fixture", "SecurityError");
					},
				});
		});
		await page.evaluate(() => sessionStorage.setItem("forge-test-block-storage", "yes"));
		await page.reload();
		await settled(page);
		assert.equal(Number(await separator.getAttribute("aria-valuenow")), 390, "Blocked storage getter uses fallback");
		await separator.focus();
		await separator.press("ArrowRight");
		assert.equal(
			Number(await separator.getAttribute("aria-valuenow")),
			410,
			"Keyboard resize survives blocked storage",
		);
		const blockedBounds = await separator.boundingBox();
		assert.ok(blockedBounds);
		await page.mouse.move(blockedBounds.x + blockedBounds.width / 2, blockedBounds.y + 100);
		await page.mouse.down();
		await page.mouse.move(blockedBounds.x + 40, blockedBounds.y + 100);
		await page.mouse.up();
		assert.ok(Number(await separator.getAttribute("aria-valuenow")) > 410, "Pointer resize survives blocked storage");
		await page.evaluate(() => sessionStorage.removeItem("forge-test-block-storage"));
		await page.reload();
		await settled(page);
		assert.equal(
			Number(await separator.getAttribute("aria-valuenow")),
			preferredWidth,
			"Blocked access did not destroy the stored width",
		);
		await page.evaluate(() =>
			Object.defineProperty(localStorage, "setItem", {
				configurable: true,
				value() {
					throw new DOMException("Quota fixture", "QuotaExceededError");
				},
			}),
		);
		await separator.focus();
		await separator.press("ArrowRight");
		assert.equal(
			Number(await separator.getAttribute("aria-valuenow")),
			preferredWidth + 20,
			"Write failures leave resizing usable",
		);
		await page.evaluate(() => Reflect.deleteProperty(localStorage, "setItem"));
		await separator.press("ArrowLeft");
		assert.equal(Number(await separator.getAttribute("aria-valuenow")), preferredWidth);
		await expectPortal(page, page.getByRole("button", { name: `Full path: ${unusual}`, exact: true }));

		await expectNoTooltip(page, page.getByLabel(/^All workspace changes:/));
		await expectNoTooltip(page, page.getByLabel(/^Shown changes:/));
		await expectNoTooltip(page, row(page, ".").getByLabel(/^\. visible subtree:/));
		await expectNoTooltip(page, row(page, "app/tracked.txt").getByLabel(/^app\/tracked.txt visible subtree:/));
		await expectNoTooltip(page, select(page, "app"), true);
		await expectNoTooltip(page, select(page, "app/tracked.txt"), true);
		await treeGeometry(page);

		const countColors = (path: string) =>
			row(page, path)
				.getByLabel(`${path} visible subtree:`, { exact: false })
				.locator(":scope > span")
				.evaluateAll((elements) =>
					elements.map((element) => element.ownerDocument.defaultView.getComputedStyle(element).color),
				);
		const folderColors = await countColors("app");
		const fileColors = await countColors("app/tracked.txt");
		assert.notDeepEqual(folderColors, fileColors, "Folder aggregates use quieter colors than own file counts");
		assert.deepEqual(
			await countColors("app/transition"),
			folderColors,
			"Changed entries with children retain aggregate treatment",
		);
		assert.deepEqual(
			await page
				.getByLabel(/^Shown changes:/)
				.locator(":scope > span")
				.evaluateAll((elements) =>
					elements.map((element) => element.ownerDocument.defaultView.getComputedStyle(element).color),
				),
			fileColors,
			"Shown totals retain ordinary count colors",
		);

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
		await inspect(page, "app/tracked.txt", "warnings").click();
		await signalDetails(page).getByText("Tracked source warning", { exact: true }).waitFor();
		renameSync(nested, suspended);
		moved = true;
		await refresh.click();
		await page.getByRole("alert").filter({ hasText: "Change summary is stale." }).waitFor();
		await summary(page, "All workspace changes", all.files, all.removed, all.added);
		await signalDetails(page).getByText("Tracked source warning", { exact: true }).waitFor();
		assert.equal(new URL(page.url()).searchParams.get("path"), "app/tracked.txt");
		renameSync(suspended, nested);
		moved = false;
		writeFileSync(tracked, original);
		await page.getByRole("button", { name: "Retry changes", exact: true }).click();
		await page.getByText(/selection.*unavailable|selected.*disappeared/i).waitFor();
		await waitSelected(page);
		assert.equal(await signalDetails(page).count(), 0, "Disappearing source removes obsolete signal details");
		await select(page, "nested").click();
		await inspect(page, "nested", "notices").click();
		await signalDetails(page).getByText("Nested repository notice", { exact: true }).waitFor();
		rmSync(join(workspace, "nested/browser-binary.dat"), { force: true });
		await refresh.click();
		await waitSelected(page, "nested");
		await page
			.getByRole("region", { name: "Selection details" })
			.getByText(/No changed entries/i)
			.waitFor();
		assert.equal(await select(page, "nested").count(), 0, "Last change disappearing hides its repository");
		assert.equal(await signalDetails(page).count(), 0, "Surviving placeholder loses its obsolete signals");
		assert.equal(await page.getByRole("alert").count(), 0);
		await verifyInstalledDiffs({ page, address, workspace, sourceState, run, screenshots });
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
			apiRequests.every(
				(path) => path === "/api/workspace" || path === "/api/changes/analysis" || path === "/api/changes/file",
			),
			apiRequests.join(", "),
		);
		assert.deepEqual(pageErrors, []);
		assert.ok(
			rejectedFilePaths.length > 0,
			"The literal backslash navigation fixture has an explicitly unsupported file request",
		);
		assert.deepEqual(consoleErrors, []);
		assert.deepEqual(
			failedRequests.filter(
				(request) =>
					!(
						request.error === "net::ERR_ABORTED" &&
						(new URL(request.url).pathname === "/api/changes/file" ||
							(new URL(request.url).pathname.startsWith("/assets/") &&
								new URL(request.url).pathname.endsWith(".js") &&
								assetResponses.some((asset) => asset.path === new URL(request.url).pathname && asset.status === 200)))
					),
			),
			[],
		);

		console.log(
			`Installed Chromium navigator: real guide policies, importance defaults, expansion-visible Shown totals/help, filters/counts, mixed direct/descendant signals, hidden source navigation/reveal, located rename messages, bounded signal details, repository placeholders, ownership/rename/transition, encoded direct loads/history, fresh/stale recovery, retained help portals, name/counter tooltip absence, matching folder matrix/zero/empty/overflow states, compact tree geometry, local assets and persisted/blocked-storage resize/scroll/narrow layout passed. Screenshots: ${screenshots}`,
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
