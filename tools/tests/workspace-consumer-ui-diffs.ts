import assert from "node:assert/strict";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Page, Route } from "playwright";

type Deps = {
	page: Page;
	address: string;
	workspace: string;
	screenshots: string;
	sourceState(workspace: string): unknown;
	run(command: string, args: string[], cwd: string): string;
};

export async function verifyInstalledDiffs({ page, address, workspace, screenshots, sourceState, run }: Deps) {
	const originals = new Map<string, { bytes: Buffer; mode: number }>();
	const created = new Set<string>();
	const renamed = new Map<string, string>();
	const index = readFileSync(join(workspace, ".git/index"));
	const objectFiles = () =>
		readdirSync(join(workspace, ".git/objects"), { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => join(entry.parentPath, entry.name));
	const originalObjects = new Set(objectFiles());
	const fixtureObjects = new Set<string>();
	const errors: string[] = [];
	const external: string[] = [];
	const onError = (error: Error) => errors.push(error.message);
	const onRequest = (request: { url(): string }) => {
		if (new URL(request.url()).origin !== address) external.push(request.url());
	};
	page.on("pageerror", onError);
	page.on("request", onRequest);
	function preserve(path: string) {
		if (!originals.has(path))
			originals.set(path, { bytes: readFileSync(join(workspace, path)), mode: lstatSync(join(workspace, path)).mode });
	}
	function write(path: string, value: string | Buffer, existing = false) {
		if (existing) preserve(path);
		else created.add(path);
		mkdirSync(dirname(join(workspace, path)), { recursive: true });
		writeFileSync(join(workspace, path), value);
	}
	async function selected(path: string, awaitFile = true) {
		const observation = awaitFile
			? page.waitForResponse((response) => {
					const url = new URL(response.url());
					return (
						url.pathname === "/api/changes/file" &&
						url.searchParams.get("path") === path &&
						url.searchParams.get("context") === "3"
					);
				})
			: Promise.resolve(undefined);
		const [response] = await Promise.all([
			observation,
			page.getByRole("button", { name: `Select ${path}`, exact: true }).click(),
		]);
		if (response) assert.equal(await response.finished(), null);
		await page.waitForURL((url) => url.searchParams.get("path") === path);
		await page.getByRole("region", { name: "File diff", exact: true }).waitFor();
	}
	const diff = () => page.getByRole("region", { name: "File diff", exact: true });
	const code = () => diff().locator("diffs-container [data-line]");
	async function text(value: string) {
		await code().filter({ hasText: value }).first().waitFor();
	}
	async function screenshot(name: string) {
		await page.mouse.move(1, 1);
		await page.locator("body").evaluate((element) => {
			const active = element.ownerDocument.activeElement;
			if (active && "blur" in active && typeof active.blur === "function") active.blur();
		});
		for (const tooltip of await page.getByRole("tooltip").all()) await tooltip.waitFor({ state: "hidden" });
		await page.screenshot({ path: join(screenshots, name) });
	}
	async function refresh() {
		const button = page.getByRole("button", { name: "Refresh", exact: true });
		await button.and(page.locator(":enabled")).waitFor();
		const path = new URL(page.url()).searchParams.get("path");
		// A briefly enabled control can precede Query's fetch notification. Wait
		// for the new observation before mutating a fixture for the next read.
		const responses = Promise.all([
			page.waitForResponse((response) => new URL(response.url()).pathname === "/api/workspace"),
			page.waitForResponse((response) => new URL(response.url()).pathname === "/api/changes/analysis"),
			page.waitForResponse((response) => {
				const url = new URL(response.url());
				return (
					url.pathname === "/api/changes/file" &&
					url.searchParams.get("path") === path &&
					url.searchParams.get("context") === "3"
				);
			}),
		]);
		const [observations] = await Promise.all([responses, button.click()]);
		for (const response of observations) {
			assert.equal(response.status(), 200);
			assert.equal(await response.finished(), null);
		}
		await button.and(page.locator(":enabled")).waitFor();
	}
	async function metadata() {
		const details = page.locator("details").filter({ has: page.getByText("Entry metadata", { exact: true }) });
		if (!(await details.evaluate((element) => element.hasAttribute("open")))) await details.locator("summary").click();
	}
	let route: ((route: Route) => Promise<void>) | undefined;
	let delayed: Route | undefined;
	try {
		const contextPath = "app/diff-context.ts";
		preserve(contextPath);
		const context = originals.get(contextPath)?.bytes.toString("utf8");
		assert.ok(context);
		write(contextPath, context.replace("line30 = 30", "line30 = 300").replace("line100 = 100", "line100 = 1000"), true);
		for (const path of ["app/diff-delete.txt", "app/diff-empty-delete.txt"]) {
			preserve(path);
			rmSync(join(workspace, path));
		}
		write("app/diff-crlf.txt", "\uFEFFnew\r\nlast\r\n", true);
		write("app/diff-eof.txt", "new\r", true);
		preserve("app/diff-mode.txt");
		chmodSync(join(workspace, "app/diff-mode.txt"), 0o755);
		for (const [oldPath, newPath] of [
			["app/diff-rename.txt", "other/diff-renamed.txt"],
			["app/diff-rename-edited.txt", "other/diff-renamed-edited.txt"],
		]) {
			assert.ok(oldPath && newPath);
			preserve(oldPath);
			renameSync(join(workspace, oldPath), join(workspace, newPath));
			renamed.set(oldPath, newPath);
		}

		run(
			"git",
			[
				"add",
				"app/diff-rename.txt",
				"other/diff-renamed.txt",
				"app/diff-rename-edited.txt",
				"other/diff-renamed-edited.txt",
			],
			workspace,
		);
		for (const path of objectFiles()) if (!originalObjects.has(path)) fixtureObjects.add(path);
		writeFileSync(
			join(workspace, "other/diff-renamed-edited.txt"),
			"first rename line\nchanged rename line\nthird rename line\n",
		);
		preserve("app/diff-link.txt");
		rmSync(join(workspace, "app/diff-link.txt"));
		symlinkSync("nonexistent-target", join(workspace, "app/diff-link.txt"));
		write("app/diff-add.ts", "export const added = true;\n");
		write("app/diff-empty-add.txt", "");
		write("app/diff-binary.dat", Buffer.from([0, 1, 2]));
		write("app/diff-encoding.txt", Buffer.from([0xff, 0xfe, 0xf0]));
		write("app/diff-too-large.txt", "x".repeat(8 * 1024 * 1024 + 1));
		write("app/diff-large.ts", Array.from({ length: 1500 }, (_, i) => `export const added${i} = ${i};\n`).join(""));
		const unusual = `app/deep/${"long-directory-".repeat(7)}/quoted " café # % ? diff.ts`;
		write(unusual, `export const longLine = "${"word ".repeat(3000)}";\n`);
		const before = sourceState(workspace);
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
		});
		await page.goto(`${address}/?path=${encodeURIComponent(contextPath)}`);
		assert.equal(
			await page.evaluate(() => Reflect.get(navigator, "onLine")),
			false,
			"The installed review starts while the browser reports offline",
		);
		await text("line30 = 300");
		assert.equal(await page.getByRole("button", { name: "Unified", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await code().filter({ hasText: "line1 = 1;" }).count(), 0);
		assert.ok(
			await diff().locator("diffs-container [data-line] span[style]").count(),
			"Local syntax tokens are rendered inside Pierre's shadow root",
		);
		await screenshot("diff-unified.png");
		await page.getByRole("button", { name: "Split", exact: true }).click();
		await diff().locator("diffs-container [data-deletions]").waitFor();
		const split = await diff()
			.locator("diffs-container [data-code]")
			.evaluateAll((elements) =>
				elements.map((element) => ({
					x: element.getBoundingClientRect().x,
					width: element.getBoundingClientRect().width,
				})),
			);
		assert.ok(
			split.length >= 2 && split[0] && split[1] && split[1].x > split[0].x,
			"Split mode displays adjacent side columns",
		);
		await screenshot("diff-split.png");

		// Operational failures are injected only at HTTP; the UI and Pierre renderer stay real.
		route = async (request) => {
			const url = new URL(request.request().url());
			if (url.searchParams.get("context") === "all")
				await request.fulfill({ status: 500, body: "context fixture unavailable" });
			else await request.continue();
		};
		await page.route("**/api/changes/file?**", route);
		await page.getByRole("button", { name: "Load omitted context", exact: true }).click();
		await diff().getByRole("alert").waitFor();
		await text("line30 = 300");
		await page.unroute("**/api/changes/file?**", route);
		route = undefined;
		await page.getByRole("button", { name: "Retry context", exact: true }).click();
		await diff().locator("diffs-container [data-expand-button]").first().waitFor();
		for (
			let attempt = 0;
			attempt < 30 && (await diff().locator("diffs-container [data-expand-button]").count());
			attempt++
		)
			await diff().locator("diffs-container [data-expand-button]").first().click();
		await text("line1 = 1;");
		await text("line70 = 70;");
		await text("line160 = 160;");
		await screenshot("diff-expanded.png");
		await page.getByRole("button", { name: "Unified", exact: true }).click();
		await diff().locator("diffs-container [data-unified]").waitFor();
		await text("line1 = 1;");
		await text("line70 = 70;");
		await text("line160 = 160;");
		await page.getByRole("button", { name: "Split", exact: true }).click();
		await diff().locator("diffs-container [data-deletions]").waitFor();
		await text("line160 = 160;");
		await refresh();
		await text("line30 = 300");
		assert.equal(await page.getByRole("button", { name: "Split", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await code().filter({ hasText: "line1 = 1;" }).count(), 0, "Refresh resets context expansion");
		writeFileSync(
			join(workspace, contextPath),
			context.replace("line30 = 30", "line30 = 301").replace("line100 = 100", "line100 = 1000"),
		);
		await page.getByRole("button", { name: "Load omitted context", exact: true }).click();
		await diff().getByRole("alert").filter({ hasText: "older observation" }).waitFor();
		await text("line30 = 300");
		assert.equal(
			await code().filter({ hasText: "line30 = 301" }).count(),
			0,
			"Incompatible complete observations cannot replace the short view",
		);
		await page.getByRole("button", { name: "Reload file", exact: true }).click();
		await text("line30 = 301");
		writeFileSync(
			join(workspace, contextPath),
			context.replace("line30 = 30", "line30 = 300").replace("line100 = 100", "line100 = 1000"),
		);
		await refresh();
		await text("line30 = 300");
		await selected("app/diff-add.ts");
		await text("export const added = true;");
		route = async (request) => {
			if (new URL(request.request().url()).searchParams.get("path") === contextPath)
				await request.fulfill({ status: 500, body: "file fixture unavailable" });
			else await request.continue();
		};
		await page.route("**/api/changes/file?**", route);
		await selected(contextPath);
		await diff().getByRole("alert").filter({ hasText: "Could not load file" }).waitFor();
		await page.getByRole("button", { name: "Select app/diff-add.ts", exact: true }).waitFor();
		await page.unroute("**/api/changes/file?**", route);
		route = undefined;
		await page.getByRole("button", { name: "Retry file", exact: true }).click();
		await text("line30 = 300");
		route = async (request) => {
			if (new URL(request.request().url()).searchParams.get("context") === "all") {
				const response = await request.fetch();
				const full = (await response.json()) as Record<string, unknown>;
				delete full.patch;
				await request.fulfill({
					json: { ...full, kind: "unsupported", reason: "too_large", limitBytes: 4 * 1024 * 1024 },
				});
			} else await request.continue();
		};
		await page.route("**/api/changes/file?**", route);
		await page.getByRole("button", { name: "Load omitted context", exact: true }).click();
		await diff().getByRole("alert").filter({ hasText: "Complete context exceeds" }).waitFor();
		await text("line30 = 300");
		await page.unroute("**/api/changes/file?**", route);
		route = undefined;
		await page.getByRole("button", { name: "Retry context", exact: true }).click();
		await diff().locator("diffs-container [data-expand-button]").first().waitFor();
		await selected("app/diff-add.ts");
		await text("export const added = true;");
		const lateResponse = await fetch(
			`${address}/api/changes/file?${new URLSearchParams({ path: contextPath, context: "3" })}`,
		);
		assert.equal(lateResponse.status, 200);
		const lateBody = await lateResponse.text();
		let capture: (() => void) | undefined;
		const captured = new Promise<void>((resolve) => {
			capture = resolve;
		});
		route = async (request) => {
			if (new URL(request.request().url()).searchParams.get("path") === contextPath) {
				delayed = request;
				capture?.();
			} else await request.continue();
		};
		await page.route("**/api/changes/file?**", route);
		await selected(contextPath, false);
		await captured;
		await selected("app/diff-add.ts");
		await text("export const added = true;");
		assert.ok(delayed);
		await delayed.fulfill({ status: 200, contentType: "application/json", body: lateBody });
		delayed = undefined;
		await page.unroute("**/api/changes/file?**", route);
		route = undefined;
		assert.equal(new URL(page.url()).searchParams.get("path"), "app/diff-add.ts");
		assert.equal(
			await code().filter({ hasText: "line30 = 300" }).count(),
			0,
			"A late obsolete short response cannot replace the selected file",
		);
		await text("export const added = true;");
		assert.equal(await page.getByRole("button", { name: "Split", exact: true }).getAttribute("aria-pressed"), "true");
		await selected("app/diff-delete.txt");
		await text("deleted text");
		for (const path of [
			"app/diff-empty-add.txt",
			"app/diff-empty-delete.txt",
			"app/diff-mode.txt",
			"other/diff-renamed.txt",
		]) {
			await selected(path);
			await diff()
				.getByText(/^Metadata-only change/)
				.first()
				.waitFor();
			assert.equal(
				await diff().locator("diffs-container").count(),
				0,
				"Metadata-only observations do not invent a text diff",
			);
		}
		await metadata();
		await page.getByText("Renamed from app/diff-rename.txt", { exact: false }).first().waitFor();
		await selected("other/diff-renamed-edited.txt");
		await text("changed rename line");
		await metadata();
		await page
			.getByRole("region", { name: "Selected entry metadata" })
			.getByText(/fixture-app/)
			.waitFor();
		await page
			.getByRole("region", { name: "Selected entry metadata" })
			.getByText(/fixture-other/)
			.waitFor();
		await selected("app/diff-link.txt");
		await text("nonexistent-target");
		await selected("app/transition");
		await page.getByRole("region", { name: "Matching subtree summary" }).waitFor();
		await text("original file");
		for (const [path, reason] of [
			["app/diff-binary.dat", /^Binary file/],
			["app/diff-encoding.txt", /^This patch uses an unsupported text encoding/],
			["app/diff-too-large.txt", /^This patch exceeds/],
		]) {
			assert.ok(path && reason);
			await selected(String(path));
			await diff()
				.getByText(reason as RegExp)
				.first()
				.waitFor();
			assert.equal(await diff().locator("diffs-container").count(), 0);
		}
		await selected("app/diff-crlf.txt");
		await text("new");
		await selected("app/diff-eof.txt");
		await text("new");
		const largeStarted = performance.now();
		await selected("app/diff-large.ts");
		await text("added1499");
		const largeLoadedMs = Math.round(performance.now() - largeStarted);
		const modeStarted = performance.now();
		await page.getByRole("button", { name: "Unified", exact: true }).click();
		await diff().locator("diffs-container [data-unified]").waitFor();
		await text("added1499");
		const largeModeMs = Math.round(performance.now() - modeStarted);
		console.log(`Installed Pierre 1500-line diff: selection/render ${largeLoadedMs}ms; mode change ${largeModeMs}ms.`);
		const pane = page.getByTestId("selection-scroll");
		await pane.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		assert.ok(await pane.evaluate((element) => element.scrollTop > 0), "Large diffs scroll in the selected pane");
		assert.equal(await page.locator("html").evaluate((element) => element.scrollTop), 0);
		await screenshot("diff-large.png");
		await selected(unusual);
		await text("longLine");
		await page.setViewportSize({ width: 360, height: 740 });
		assert.ok(await page.locator("body").evaluate((element) => element.scrollWidth <= 360));
		await screenshot("diff-long-narrow.png");
		await page.setViewportSize({ width: 1100, height: 800 });
		await page.getByRole("button", { name: "Unified", exact: true }).click();
		await screenshot("diff-long.png");
		assert.deepEqual(sourceState(workspace), before, "UI diff reads preserve source, index, refs and object contents");
		assert.deepEqual(errors, []);
		assert.deepEqual(external, []);
		console.log(
			`Installed Chromium Pierre: unified/split highlighting, complete-context expansion/retry, Refresh, metadata/empty/mode/rename/type transitions, unsupported responses, CRLF/EOF, substantial diff and narrow long paths passed. Screenshots: ${screenshots}`,
		);
	} finally {
		if (delayed) await delayed.abort().catch(() => {});
		if (route) await page.unroute("**/api/changes/file?**", route);
		for (const [oldPath, newPath] of renamed) {
			rmSync(join(workspace, newPath), { force: true });
			const original = originals.get(oldPath);
			assert.ok(original);
			writeFileSync(join(workspace, oldPath), original.bytes);
		}
		for (const path of created) rmSync(join(workspace, path), { force: true });
		for (const [path, original] of originals) {
			rmSync(join(workspace, path), { force: true });
			writeFileSync(join(workspace, path), original.bytes);
			chmodSync(join(workspace, path), original.mode);
		}
		writeFileSync(join(workspace, ".git/index"), index);
		for (const path of fixtureObjects) rmSync(path, { force: true });
		page.off("pageerror", onError);
		page.off("request", onRequest);
	}
}
