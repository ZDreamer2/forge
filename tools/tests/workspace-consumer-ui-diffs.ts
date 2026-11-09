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
import type { Locator, Page, Route } from "playwright";

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
		return response;
	}
	const diff = () => page.getByRole("region", { name: "File diff", exact: true });
	const code = () => diff().locator("diffs-container [data-line]");
	async function text(value: string) {
		await code().filter({ hasText: value }).first().waitFor();
	}
	// Start at the actual DOM click, after Playwright's locator/scroll/actionability work.
	// ResourceTiming and the next painted layout use the same browser clock.
	async function measuredSelection(path: string, marker: string, condition: string) {
		await page.locator("body").evaluate(
			(element, { path, marker }) => {
				const document = element.ownerDocument;
				const view = document.defaultView;
				const sample = { clicked: 0, readable: 0 };
				Reflect.set(globalThis, "forgeSelectionSample", sample);
				document.addEventListener(
					"click",
					function clicked(event: { target: { closest?(selector: string): typeof element } | null }) {
						const target =
							event.target && "closest" in event.target && typeof event.target.closest === "function"
								? event.target.closest("button")
								: null;
						if (target?.getAttribute("aria-label") !== `Select ${path}`) return;
						document.removeEventListener("click", clicked, true);
						sample.clicked = performance.now();
						function frame() {
							const host = document.querySelector("diffs-container");
							const line = Array.from<typeof element>(host?.shadowRoot?.querySelectorAll("[data-line]") ?? []).find(
								(element) => element.textContent?.includes(marker),
							);
							if (!line || line.getBoundingClientRect().height === 0) return void view.requestAnimationFrame(frame);
							view.requestAnimationFrame(() => {
								sample.readable = performance.now();
							});
						}
						view.requestAnimationFrame(frame);
					},
					true,
				);
			},
			{ path, marker },
		);
		const response = await selected(path);
		assert.ok(response);
		const body = (await response.json()) as { patch: string };
		await page.waitForFunction(() => Reflect.get(globalThis, "forgeSelectionSample").readable > 0);
		const timing = await page.evaluate((path) => {
			const sample = Reflect.get(globalThis, "forgeSelectionSample") as { clicked: number; readable: number };
			const resource = performance
				.getEntriesByType("resource")
				.filter((entry) => {
					const url = new URL(entry.name);
					return (
						url.pathname === "/api/changes/file" &&
						url.searchParams.get("path") === path &&
						entry.startTime >= sample.clicked
					);
				})
				.at(-1) as { startTime: number; responseStart: number; responseEnd: number } | undefined;
			if (!resource) throw new Error("Selected file has no browser ResourceTiming");
			const round = (value: number) => Math.round(value * 10) / 10;
			return {
				selectionToRequestMs: round(resource.startTime - sample.clicked),
				requestToHeadersMs: round(resource.responseStart - resource.startTime),
				requestToBodyMs: round(resource.responseEnd - resource.startTime),
				bodyToReadableFrameMs: round(sample.readable - resource.responseEnd),
				selectionToReadableFrameMs: round(sample.readable - sample.clicked),
			};
		}, path);
		console.log(
			`Installed sidebar selection: ${JSON.stringify({ path, condition, patchBytes: Buffer.byteLength(body.patch), ...timing })}`,
		);
	}
	async function wrapping(target: Locator, markers: string[], gutters: boolean) {
		const geometry = await target.evaluate(
			(element, { markers, gutters }) => {
				const root = element.shadowRoot ?? element;
				const document = element.ownerDocument;
				const view = document.defaultView;
				const hostBounds = element.getBoundingClientRect();
				function character(container: Parameters<typeof document.createTreeWalker>[0], offset: number) {
					const walker = document.createTreeWalker(container, 4 /* SHOW_TEXT */);
					for (let node = walker.nextNode(); node; node = walker.nextNode()) {
						const length = node.textContent?.length ?? 0;
						if (offset < length) {
							const range = document.createRange();
							range.setStart(node, offset);
							range.setEnd(node, offset + 1);
							return range.getBoundingClientRect();
						}
						offset -= length;
					}
					throw new Error("Missing text endpoint");
				}
				return markers.map((marker) => {
					const line = gutters
						? Array.from<typeof element>(root.querySelectorAll("[data-line]")).find((line) =>
								line.textContent?.includes(marker),
							)
						: element;
					if (!line) throw new Error(`Missing wrapped line ${marker}`);
					const contents = line.textContent ?? "";
					const endOffset = contents.indexOf(marker) + marker.length - 1;
					const startOffset = gutters ? contents.search(/\S/) : contents.lastIndexOf("\n", endOffset) + 1;
					const first = character(line, startOffset);
					const last = character(line, endOffset);
					const column = gutters ? line.closest("[data-code]") : element;
					if (!column) throw new Error("Missing code column");
					const bounds = (gutters ? column.querySelector("[data-content]") : column).getBoundingClientRect();
					const index = line.getAttribute("data-line-index");
					const gutter = gutters
						? column.querySelector(`[data-gutter] [data-line-index="${index}"] [data-line-number-content]`)
						: null;
					const gutterTop = gutter?.getBoundingClientRect().top;
					const gutterRow = gutter?.closest("[data-column-number]");
					const changedGutter = gutterRow?.getAttribute("data-line-type")?.startsWith("change-");
					const bar = changedGutter ? view.getComputedStyle(gutterRow, "::before") : undefined;
					const hasBar = bar && bar.content !== "none" && bar.content !== "normal";
					const changeBarRight = hasBar
						? gutterRow.getBoundingClientRect().left +
							Number.parseFloat(view.getComputedStyle(gutterRow).borderLeftWidth) +
							Number.parseFloat(bar.left) +
							Number.parseFloat(bar.width)
						: undefined;
					const gutterFirstGlyphLeft = gutter ? character(gutter, 0).left : undefined;
					const pane = document.querySelector('[data-testid="selection-scroll"]');
					if (!pane) throw new Error("Missing selected-file scroll pane");
					pane.scrollTop += last.bottom - pane.getBoundingClientRect().bottom + 20;
					const visibleEnd = character(line, endOffset);
					const visiblePane = pane.getBoundingClientRect();
					return {
						endpointVisible: visibleEnd.top >= visiblePane.top && visibleEnd.bottom <= visiblePane.bottom,
						hostLeft: hostBounds.left,
						hostRight: hostBounds.right,
						lineCharacters: endOffset - startOffset + 1,

						marker,
						firstX: first.x,
						lastX: last.x,
						lastRight: last.right,
						firstTop: first.top,
						lastBottom: last.bottom,
						columnLeft: bounds.left,
						columnRight: bounds.right,
						lineHeight: Number.parseFloat(view.getComputedStyle(line).lineHeight),
						gutterTop,
						gutterNumber: gutter?.textContent?.trim(),
						changeBarRight,
						gutterFirstGlyphLeft,
					};
				});
			},
			{ markers, gutters },
		);
		for (const line of geometry) {
			assert.ok(line.endpointVisible, `${line.marker} endpoint is visible after vertical pane scrolling`);
			assert.ok(
				line.firstX >= line.hostLeft - 1 &&
					line.lastRight <= line.hostRight + 1 &&
					line.columnRight <= line.hostRight + 1,
				`${line.marker} remains inside the visible renderer host: ${JSON.stringify(line)}`,
			);
			assert.ok(
				line.lastBottom - line.firstTop > line.lineHeight * 1.5,
				`${line.marker} occupies multiple visual lines`,
			);
			assert.ok(
				line.firstX >= line.columnLeft - 1 &&
					line.lastX >= line.columnLeft - 1 &&
					line.lastRight <= line.columnRight + 1,
				`${line.marker} endpoints fit its own code pane: ${JSON.stringify(line)}`,
			);
			if (gutters) {
				if (line.changeBarRight !== undefined)
					assert.ok(
						line.gutterFirstGlyphLeft !== undefined && line.gutterFirstGlyphLeft >= line.changeBarRight,
						`The first gutter digit remains clear of the change bar: ${JSON.stringify(line)}`,
					);
				assert.ok(line.gutterTop !== undefined, "Wrapped line retains its numbered gutter");
				assert.ok(
					Math.abs(line.gutterTop - line.firstTop) < line.lineHeight / 2,
					`Gutter anchors to first visual line: ${JSON.stringify(line)}`,
				);
			}
		}
		assert.ok(
			await target
				.page()
				.getByTestId("selection-scroll")
				.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
			"Selected content fits the pane without clipping or horizontal overflow",
		);
		assert.ok(
			await target
				.page()
				.locator("body")
				.evaluate((element) => element.scrollWidth <= element.ownerDocument.defaultView.innerWidth),
			"Wrapped content fits the page",
		);
		if (gutters)
			assert.ok(
				await target
					.locator("[data-code] > [data-content]")
					.evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth + 1)),
				"Every split/unified code column wraps within its own bounds",
			);
		console.log(
			`Installed wrapping geometry: ${JSON.stringify({ viewport: target.page().viewportSize(), gutters, sidebar: await target.page().getByRole("separator", { name: "Resize changes sidebar" }).getAttribute("aria-valuenow"), columnWidths: geometry.map((line) => Math.round(line.columnRight - line.columnLeft)), lineCharacters: geometry.map((line) => line.lineCharacters), endpointVisible: true, firstLineGutters: gutters })}`,
		);
		return geometry;
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
		write(
			unusual,
			`    export const longLine = "${"word ".repeat(3000)}END_WORDS";\n    export const token = "${"T".repeat(1500)}END_TOKEN";\n`,
		);
		const before = sourceState(workspace);
		await page.addInitScript(() => {
			Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
		});
		console.log(
			`Installed selection environment: ${JSON.stringify({ node: process.version, chromium: page.context().browser()?.version(), viewport: page.viewportSize(), fixtureChanges: run("git", ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"], workspace).trim().split("\n").length, largeLines: 1500, longWords: 3000, longTokenCharacters: 1500, language: "typescript", build: "fresh packed production" })}`,
		);
		for (const [path, marker] of [
			["app/diff-add.ts", "export const added = true;"],
			["app/diff-large.ts", "added0 = 0;"],
		]) {
			assert.ok(path && marker);
			await page.goto(address);
			await measuredSelection(path, marker, "cold page, first sidebar file");
			for (let sample = 1; sample <= 2; sample++) {
				await selected(path === "app/diff-add.ts" ? "app/diff-large.ts" : "app/diff-add.ts");
				await text(path === "app/diff-add.ts" ? "added0 = 0;" : "export const added = true;");
				await measuredSelection(path, marker, `repeated ${sample}`);
			}
		}
		// Keep measurement workloads comparable: this tracked file becomes changed
		// only after all six sidebar timing samples have completed.
		const numbersPath = "app/diff-numbers.ts";
		preserve(numbersPath);
		const numbersOriginal = originals.get(numbersPath);
		assert.ok(numbersOriginal);
		const numberedLines = numbersOriginal.bytes.toString("utf8").split("\n");
		numberedLines[99_999] = `${"word ".repeat(60)}END_NUMBER_WORDS`;
		numberedLines[100_001] = `${"T".repeat(260)}END_NUMBER_TOKEN`;
		write(numbersPath, numberedLines.join("\n"), true);
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
			.locator("diffs-container [data-code] > [data-content]")
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
		await selected("app/diff-large.ts");
		await text("added1499");
		await page.getByRole("button", { name: "Unified", exact: true }).click();
		await diff().locator("diffs-container [data-unified]").waitFor();
		await text("added1499");
		const pane = page.getByTestId("selection-scroll");
		await pane.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		assert.ok(await pane.evaluate((element) => element.scrollTop > 0), "Large diffs scroll in the selected pane");
		assert.equal(await page.locator("html").evaluate((element) => element.scrollTop), 0);
		await screenshot("diff-large.png");
		await selected(unusual);
		await text("END_TOKEN");
		const markers = ["END_WORDS", "END_TOKEN"];
		for (const width of [1100, 360]) {
			await page.setViewportSize({ width, height: 800 });
			for (const mode of ["Unified", "Split"]) {
				await page.getByRole("button", { name: mode, exact: true }).click();
				await text("END_TOKEN");
				await wrapping(diff().locator("diffs-container"), markers, true);
			}
		}
		await pane.evaluate((element) => {
			element.scrollTop = 0;
		});
		await screenshot("diff-long-path-narrow.png");
		await wrapping(diff().locator("diffs-container"), markers, true);
		await pane.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
		await screenshot("diff-long-token-end-narrow.png");
		await page.setViewportSize({ width: 1100, height: 800 });
		// A tracked modification retains both split columns; added files alone
		// may occupy a single full-width column in Pierre.
		const contextBeforeWrapping = readFileSync(join(workspace, contextPath));
		writeFileSync(
			join(workspace, contextPath),
			context
				.replace("line30 = 30", `line30 = "${"word ".repeat(60)}END_WORDS"`)
				.replace("line100 = 100", `line100 = "${"T".repeat(260)}END_TOKEN"`),
		);
		await selected(contextPath);
		await text("END_TOKEN");
		for (const mode of ["Unified", "Split"]) {
			await page.getByRole("button", { name: mode, exact: true }).click();
			await text("END_TOKEN");
			if (mode === "Split")
				assert.equal(
					await diff().locator("diffs-container [data-code]").count(),
					2,
					"Wrapping exercises both split columns",
				);
			await wrapping(diff().locator("diffs-container"), markers, true);
			await pane.evaluate((element) => {
				element.scrollTop = 0;
			});
			await screenshot(`diff-long-${mode.toLowerCase()}.png`);
		}
		const separator = page.getByRole("separator", { name: "Resize changes sidebar" });
		const savedWidth = Number(await separator.getAttribute("aria-valuenow"));
		await separator.focus();
		await separator.press("ArrowRight");
		const resizedWidth = Number(await separator.getAttribute("aria-valuenow"));
		assert.ok(resizedWidth > savedWidth);
		assert.equal(await page.evaluate(() => localStorage.getItem("forge-sidebar-width")), String(resizedWidth));
		for (const mode of ["Unified", "Split"]) {
			await page.getByRole("button", { name: mode, exact: true }).click();
			await text("END_TOKEN");
			if (mode === "Split")
				assert.equal(
					await diff().locator("diffs-container [data-code]").count(),
					2,
					"Wrapping exercises both split columns",
				);
			await wrapping(diff().locator("diffs-container"), markers, true);
		}
		await page.reload();
		await text("END_TOKEN");
		assert.equal(
			Number(await separator.getAttribute("aria-valuenow")),
			resizedWidth,
			"Wrapped view restores resized sidebar",
		);
		await page.setViewportSize({ width: 360, height: 740 });
		for (const mode of ["Unified", "Split"]) {
			await page.getByRole("button", { name: mode, exact: true }).click();
			await text("END_TOKEN");
			if (mode === "Split")
				assert.equal(
					await diff().locator("diffs-container [data-code]").count(),
					2,
					"Wrapping exercises both split columns",
				);
			await wrapping(diff().locator("diffs-container"), markers, true);
			await pane.evaluate((element) => {
				element.scrollTop = 0;
			});
			await screenshot(`diff-long-narrow-${mode.toLowerCase()}.png`);
		}
		await selected(numbersPath);
		await text("END_NUMBER_TOKEN");
		for (const mode of ["Unified", "Split"]) {
			await page.getByRole("button", { name: mode, exact: true }).click();
			await text("END_NUMBER_TOKEN");
			if (mode === "Split") assert.equal(await diff().locator("diffs-container [data-code]").count(), 2);
			const numbered = await wrapping(
				diff().locator("diffs-container"),
				["END_NUMBER_WORDS", "END_NUMBER_TOKEN"],
				true,
			);
			assert.deepEqual(
				numbered.map((line) => line.gutterNumber),
				["100000", "100002"],
				"Six-digit numbers remain attached to their actual wrapped rows",
			);
			await screenshot(`diff-six-digit-narrow-${mode.toLowerCase()}-end.png`);
			await pane.evaluate((element) => {
				element.scrollTop = 0;
			});
			await screenshot(`diff-six-digit-narrow-${mode.toLowerCase()}.png`);
		}
		await page.setViewportSize({ width: 1100, height: 800 });
		await separator.focus();
		await separator.press("ArrowLeft");
		assert.equal(Number(await separator.getAttribute("aria-valuenow")), savedWidth);

		writeFileSync(join(workspace, contextPath), contextBeforeWrapping);
		writeFileSync(join(workspace, numbersPath), numbersOriginal.bytes);

		// A separate real page isolates this explicitly expected parser report from
		// the ordinary consumer's strict unexpected-console-error assertion.
		const browser = page.context().browser();
		assert.ok(browser);
		const fallbackPage = await browser.newPage({ viewport: page.viewportSize() });
		const fallbackErrors: string[] = [];
		const fallbackReports: string[] = [];
		fallbackPage.on("pageerror", (error) => fallbackErrors.push(error.message));
		fallbackPage.on("request", onRequest);
		fallbackPage.on("console", (message) => {
			if (message.type() === "error") fallbackReports.push(message.text());
		});
		const malformed = `not a valid patch\n    ${"word ".repeat(3000)}END_WORDS\n    ${"T".repeat(1500)}END_TOKEN\n`;
		try {
			await fallbackPage.route("**/api/changes/file?**", async (request) => {
				const response = await request.fetch();
				const body = await response.json();
				await request.fulfill({ json: { ...body, patch: malformed } });
			});
			await fallbackPage.goto(`${address}/?path=${encodeURIComponent(unusual)}`);
			await fallbackPage.getByRole("button", { name: "Show plain patch", exact: true }).click();
			const plain = fallbackPage.getByRole("region", { name: "Plain text patch", exact: true }).locator("pre");
			assert.equal(await plain.textContent(), malformed, "Literal fallback preserves indentation and newlines");
			for (const width of [1100, 360]) {
				await fallbackPage.setViewportSize({ width, height: 800 });
				await wrapping(plain, markers, false);
				assert.ok(
					await fallbackPage
						.getByTestId("selection-scroll")
						.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
				);
				await fallbackPage.screenshot({ path: join(screenshots, `diff-fallback-${width}-end.png`) });
				await fallbackPage.getByTestId("selection-scroll").evaluate((element) => {
					element.scrollTop = 0;
				});
				await fallbackPage.screenshot({ path: join(screenshots, `diff-fallback-${width}.png`) });
			}
			await fallbackPage.unroute("**/api/changes/file?**");
			await fallbackPage.getByRole("button", { name: "Reload file", exact: true }).click();
			await fallbackPage.locator("diffs-container [data-line]").filter({ hasText: "END_TOKEN" }).waitFor();
			assert.equal(
				await fallbackPage.getByRole("alert").count(),
				0,
				"Reload recovers real parser failure after injected fault clears",
			);
			assert.deepEqual(fallbackErrors, []);
			assert.equal(fallbackReports.length, 1, "Injected parser failure reports once");
			assert.match(fallbackReports[0] ?? "", /Unexpected Forge failure/);
		} finally {
			await fallbackPage.close();
		}

		assert.deepEqual(sourceState(workspace), before, "UI diff reads preserve source, index, refs and object contents");
		assert.deepEqual(errors, []);
		assert.deepEqual(external, []);
		console.log(
			`Installed Chromium Pierre: unified/split highlighting, complete-context expansion/retry, Refresh, metadata/empty/mode/rename/type transitions, unsupported responses, CRLF/EOF, measured sidebar selections, substantial diff, wrapped words/tokens in unified/split ordinary/narrow/resized panes, first-line/six-digit gutters, injected long plain-patch fallback/Reload and narrow long paths passed. Screenshots: ${screenshots}`,
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
