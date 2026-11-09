// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it, vi } from "vitest";
import App from "../App";
import { fileHandler } from "../Lib/Testing/Testing";

vi.mock(
	"../Components/WorkspaceReview/Components/SelectionViewer/Components/FileDiff/Internal/pierreRenderer",
	async () => (await import("../Lib/Testing/Testing")).rendererBoundary(),
);

const suite = createTestSuiteLifecycle({
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [() => cleanup()],
	runCleanup: (finish) => act(finish),
});

const identity: WorkspaceIdentity = {
	workspace: { name: "Canonical workspace", root: "/fixture" },
	repositories: [
		{ path: ".", status: "available", gitRoot: "/fixture" },
		{ path: "tools/nested", status: "available", gitRoot: "/fixture/tools/nested" },
		{ path: "external/empty", status: "available", gitRoot: "/fixture/external/empty" },
		{ path: "missing", status: "missing" },
	],
};
function node(path: string, extra: Partial<AnalysisWireNode> = {}): AnalysisWireNode {
	return {
		path,
		children: [],
		classification: { value: "code" },
		effectiveEmphasis: { value: "normal" },
		signals: [],
		signalCounts: { notice: 0, warning: 0 },
		rawTotals: { added: 0, removed: 0 },
		attentionTotals: { added: 0, removed: 0 },
		...extra,
	};
}
function changed(
	path: string,
	added: number,
	removed: number,
	extra: Partial<AnalysisWireNode> = {},
): AnalysisWireNode {
	return node(path, {
		kind: "modified",
		repo: ".",
		statistics: { added, removed, binary: false },
		current: { path, kind: "file", repository: ".", codebase: "src" },
		...extra,
	});
}
function fixture(): WorkspaceAnalysis {
	const entries = [
		node(".", {
			children: ["src", "tests", "docs", "config", "assets", "tools", "old", "__proto__"],
			rawTotals: { added: 43, removed: 19 },
			attentionTotals: { added: 25, removed: 10 },
			current: { path: ".", kind: "directory", repository: ".", repositoryRoot: "." },
		}),
		node("src", {
			children: ["src/high.ts", "src/normal.ts", "src/zero.ts", "src/moved.ts", "src/transition"],
			current: { path: "src", kind: "directory", repository: ".", codebase: "src", codebaseRoot: "src" },
		}),
		changed("src/high.ts", 10, 2, {
			effectiveEmphasis: {
				value: "emphasized",
				reason: "Critical code",
				handler: "guide#annotateNode",
				origin: "src/high.ts",
			},
		}),
		changed("src/normal.ts", 4, 1),
		changed("src/zero.ts", 0, 0),
		changed("src/moved.ts", 0, 0, {
			kind: "renamed",
			from: "old/moved.ts",
			renameContentChanged: false,
			base: { path: "old/moved.ts", kind: "file", repository: "tools/nested", codebase: "old" },
		}),
		changed("src/transition", 2, 2, {
			children: ["src/transition/child.md"],
			base: { path: "src/transition", kind: "file", repository: ".", codebase: "src" },
			current: { path: "src/transition", kind: "directory", repository: ".", codebase: "src" },
		}),
		changed("src/transition/child.md", 5, 1, { kind: "added", classification: { value: "docs" } }),
		node("tests", {
			children: ["tests/unit", "tests/reset.ts"],
			effectiveEmphasis: { value: "deemphasized", reason: "Tests", handler: "guide#annotateNode", origin: "tests" },
		}),
		node("tests/unit", { children: ["tests/unit/sample.ts"] }),
		changed("tests/unit/sample.ts", 3, 5, {
			classification: { value: "tests", reason: "Test source", handler: "guide#classifyNode" },
			effectiveEmphasis: { value: "deemphasized", reason: "Tests", handler: "guide#annotateNode", origin: "tests" },
		}),
		changed("tests/reset.ts", 2, 1, {
			classification: { value: "code", reason: "Explicit override", handler: "app#classifyNode" },
			emphasis: { value: "normal", reason: "Review this test", handler: "app#annotateNode" },
			effectiveEmphasis: {
				value: "normal",
				reason: "Review this test",
				handler: "app#annotateNode",
				origin: "tests/reset.ts",
			},
		}),
		node("docs", { children: ["docs/hidden.md"] }),
		changed("docs/hidden.md", 7, 0, { classification: { value: "docs" }, effectiveEmphasis: { value: "hidden" } }),
		node("config", { children: ["config/setup.json"] }),
		changed("config/setup.json", 1, 3, {
			classification: { value: "config", reason: "Workspace override", handler: "workspace#classifyNode" },
		}),
		node("assets", { children: ["assets/logo.png"] }),
		changed("assets/logo.png", 80, 90, {
			statistics: { added: 80, removed: 90, binary: true },
			classification: { value: "assets" },
			effectiveEmphasis: { value: "emphasized" },
		}),
		node("tools", { children: ["tools/nested"] }),
		node("tools/nested", {
			children: ["tools/nested/demo.ts"],
			current: {
				path: "tools/nested",
				kind: "directory",
				repository: "tools/nested",
				repositoryRoot: "tools/nested",
				codebase: "tools/nested",
				codebaseRoot: "tools/nested",
			},
		}),
		changed("tools/nested/demo.ts", 8, 4, {
			repo: "tools/nested",
			classification: { value: "assets" },
			effectiveEmphasis: { value: "deemphasized" },
			current: { path: "tools/nested/demo.ts", kind: "file", repository: "tools/nested", codebase: "tools/nested" },
		}),
		node("old", { base: { path: "old", kind: "directory", repository: ".", codebase: "old", codebaseRoot: "old" } }),
		changed("__proto__", 1, 0),
	];
	return {
		root: ".",
		nodes: Object.fromEntries(entries.map((entry) => [entry.path, entry])),
		codebases: {
			src: { id: "application", root: "src", guidance: "guides/app" },
			old: { id: "old-owner", root: "old", guidance: "guides/old" },
			"tools/nested": { id: "nested-tool", root: "tools/nested", guidance: "guides/tool" },
		},
		handlers: {},
	};
}
function start() {
	suite.createHttpScenario(
		fileHandler(fixture()),
		http.get("http://localhost/api/workspace", () => Response.json(identity)),
		http.get("http://localhost/api/changes/analysis", () => Response.json(fixture())),
	);
	return render(<App queryClient={suite.createQueryClient()} env="test" />);
}
function totals(label: string, files: number, removed: number, added: number) {
	return screen.getByRole("button", {
		name: `${label}: ${files} changed files, ${removed} removed lines, ${added} added lines`,
	});
}
function row(path: string): HTMLElement {
	const button = screen.getByRole("button", { name: `Select ${path}` });
	const element = button.closest<HTMLElement>("[data-path]");
	if (!element) throw new Error(`Missing row for ${path}`);
	return element;
}

it("reviews default breakdowns, filters both dimensions and inspects metadata without losing canonical counts", async () => {
	start();
	await screen.findByRole("button", { name: "Select src/high.ts" });
	await screen.findByRole("heading", { name: identity.workspace.name });
	totals("All workspace changes", 13, 19, 43);
	totals("Shown changes", 10, 10, 25);
	const user = userEvent.setup();
	expect(screen.getByRole("button", { name: "Collapse tests" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand tests/unit" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand tools" })).toBeInTheDocument();
	totals(". visible subtree", 12, 19, 36);
	await user.click(screen.getByRole("button", { name: "Expand tools" }));
	expect(screen.getByRole("button", { name: "Expand tools/nested" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand tools/nested" }));
	await user.click(screen.getByRole("button", { name: "Expand tests/unit" }));
	totals("Shown changes", 12, 19, 36);
	await user.click(screen.getByRole("button", { name: "Collapse src/transition" }));
	totals("Shown changes", 11, 18, 31);
	totals("src/transition visible subtree", 2, 3, 7);
	await user.click(screen.getByRole("button", { name: "Expand src/transition" }));
	await user.click(screen.getByRole("button", { name: "Collapse all" }));
	totals("Shown changes", 0, 0, 0);
	totals(". visible subtree", 12, 19, 36);
	await user.click(screen.getByRole("button", { name: "Expand ." }));
	expect(screen.getByRole("button", { name: "Expand src" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand tests" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand all" }));
	totals("Shown changes", 12, 19, 36);
	expect(within(row(".")).getByRole("button", { name: "Select ." })).toHaveTextContent("Canonical workspace");
	expect(screen.queryByRole("button", { name: "Select external/empty" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select missing" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select external" })).not.toBeInTheDocument();
	totals("src/transition visible subtree", 2, 3, 7);
	expect(screen.queryByRole("button", { name: "Select old" })).not.toBeInTheDocument();
	expect(screen.getByRole("button", { name: "current codebase boundary: application" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "current repository boundary: tools/nested" })).toBeInTheDocument();
	expect(row("__proto__")).toBeInTheDocument();
	expect(row("tests/reset.ts")).toHaveAttribute("data-importance", "medium");
	expect(screen.queryByRole("button", { name: "Select docs/hidden.md" })).not.toBeInTheDocument();

	async function inspectSubtree(path: string, files: number, removed: number, added: number) {
		const name = `${path} visible subtree: ${files} changed files, ${removed} removed lines, ${added} added lines`;
		expect(within(row(path)).getByRole("button", { name })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: `Select ${path}` }));
		const selection = within(screen.getByRole("region", { name: "Selection details" }));
		expect(selection.getByRole("button", { name })).toBeInTheDocument();
		expect(selection.getByText(new RegExp(`${files} visible changed files`))).toBeInTheDocument();
	}
	await inspectSubtree("src/transition", 2, 3, 7);
	await inspectSubtree(".", 12, 19, 36);
	await inspectSubtree("tools", 1, 4, 8);
	await inspectSubtree("tools/nested", 1, 4, 8);
	await user.click(screen.getByRole("button", { name: "Select tools/nested" }));
	const visibleTotals = totals("Shown changes", 12, 19, 36);
	await user.hover(visibleTotals);
	const tooltip = within(await screen.findByRole("tooltip"));
	const types = within(tooltip.getByRole("table", { name: "Type" }));
	const importance = within(tooltip.getByRole("table", { name: "Importance" }));
	// Code includes the explicit override under a Tests directory; columns are removed, then added.
	expect(
		within(types.getByRole("row", { name: "Code −6 +19" }))
			.getAllByRole("cell")
			.map((cell) => cell.textContent),
	).toEqual(["−6", "+19"]);
	expect(types.getByRole("row", { name: "Tests −5 +3" })).toBeInTheDocument();
	expect(
		within(importance.getByRole("row", { name: "High −2 +10" }))
			.getAllByRole("cell")
			.map((cell) => cell.textContent),
	).toEqual(["−2", "+10"]);
	expect(importance.queryByRole("rowheader", { name: "None" })).not.toBeInTheDocument();
	await user.unhover(visibleTotals);

	await user.click(screen.getByRole("button", { name: "Tests" }));
	totals("Shown changes", 11, 14, 33);
	expect(screen.queryByRole("button", { name: "Select tests/unit/sample.ts" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select tests/unit" })).not.toBeInTheDocument();
	expect(row("tests/reset.ts")).toBeInTheDocument();
	expect(row("tests")).toBeInTheDocument();
	expect(row("src/normal.ts")).toBeInTheDocument();
	totals("All workspace changes", 13, 19, 43);
	await user.click(screen.getByRole("button", { name: "Tests" }));
	expect(row("tests/unit/sample.ts")).toBeInTheDocument();

	await user.click(screen.getByRole("button", { name: "Docs" }));
	await inspectSubtree("src/transition", 1, 2, 2);
	expect(screen.queryByRole("button", { name: "Select src/transition/child.md" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Select src/transition" }));
	await user.click(screen.getByRole("button", { name: "Docs" }));

	await user.click(screen.getByRole("button", { name: "Low" }));
	totals("Shown changes", 10, 10, 25);
	expect(screen.queryByRole("button", { name: "Select tools/nested" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select tools" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select tests/unit/sample.ts" })).not.toBeInTheDocument();
	expect(row("tests/reset.ts")).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Code" }));
	totals("Shown changes", 3, 4, 6);
	await inspectSubtree("src/transition", 1, 1, 5);
	expect(screen.getByRole("region", { name: "Selection details" })).toHaveTextContent(
		"The selected change is outside the current filters",
	);
	await user.click(screen.getByRole("button", { name: "Select src/transition" }));
	expect(screen.queryByRole("button", { name: "Select tests" })).not.toBeInTheDocument();
	expect(row("config/setup.json")).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "None" }));
	totals("Shown changes", 3, 4, 6);
	expect(screen.getByRole("button", { name: "Expand docs" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand docs" }));
	totals("Shown changes", 4, 4, 13);
	expect(row("docs/hidden.md")).toBeInTheDocument();
	totals("All workspace changes", 13, 19, 43);

	// Bulk actions change only matching branches; excluded choices survive.
	await user.click(screen.getByRole("button", { name: "Collapse docs" }));
	await user.click(screen.getByRole("button", { name: "Docs" }));
	await user.click(screen.getByRole("button", { name: "Collapse all" }));
	await user.click(screen.getByRole("button", { name: "Expand all" }));
	await user.click(screen.getByRole("button", { name: "Docs" }));
	expect(screen.getByRole("button", { name: "Expand docs" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand docs" }));

	await user.click(screen.getByRole("button", { name: "Deselect all types and importance levels" }));
	totals("Shown changes", 0, 0, 0);
	expect(screen.queryByRole("button", { name: "Select ." })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select tools/nested" })).not.toBeInTheDocument();
	expect(
		within(screen.getByRole("navigation", { name: "Changed files" })).getByText("No changes match the filters"),
	).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select src/zero.ts" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Select all types and importance levels" }));
	totals("Shown changes", 13, 19, 43);
	expect(row("tools/nested/demo.ts")).toBeInTheDocument();
	expect(row("tests/unit/sample.ts")).toBeInTheDocument();
	expect(row("src/zero.ts")).toBeInTheDocument();
	expect(row("src/moved.ts")).toBeInTheDocument();
	expect(row("assets/logo.png")).toBeInTheDocument();
	expect(row("docs/hidden.md")).toBeInTheDocument();
	async function inspectMetadata(path: string) {
		await user.click(screen.getByRole("button", { name: `Select ${path}` }));
		const metadata = within(screen.getByRole("region", { name: "Selected entry metadata" }));
		const disclosure = metadata.getByText("Entry metadata");
		if (!disclosure.closest("details")?.open) await user.click(disclosure);
		return metadata;
	}
	const zero = await inspectMetadata("src/zero.ts");
	expect(zero.getByText(/No line changes were reported/)).toBeVisible();
	const binary = await inspectMetadata("assets/logo.png");
	expect(binary.getByText("Binary change. Line totals are unavailable.")).toBeVisible();
	const transition = await inspectMetadata("src/transition");
	expect(transition.getByRole("heading", { name: "Modified entry" })).toBeVisible();
	expect(transition.getByText(/^directory ·/)).toBeVisible();
	const renamed = await inspectMetadata("src/moved.ts");
	expect(renamed.getByText(/^Renamed from/)).toBeVisible();
	expect(renamed.getByText(/^Renamed from/)).toHaveTextContent("old/moved.ts");
	expect(renamed.getByText(/Codebase: old-owner/)).toBeVisible();
	expect(renamed.getByText(/Codebase: application/)).toBeVisible();
	expect(renamed.getByText("Rename has no reported content change.")).toBeVisible();
	totals("All workspace changes", 13, 19, 43);
}, 20_000);
