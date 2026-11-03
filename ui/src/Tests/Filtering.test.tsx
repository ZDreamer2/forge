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
			children: ["tests/sample.ts", "tests/reset.ts"],
			effectiveEmphasis: { value: "deemphasized", reason: "Tests", handler: "guide#annotateNode", origin: "tests" },
		}),
		changed("tests/sample.ts", 3, 5, {
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

it("counts own entries once, retains repository denominators and honors independent server classifications and emphasis", async () => {
	start();
	await screen.findByRole("button", { name: "Select src/high.ts" });
	totals("All workspace changes", 13, 19, 43);
	totals("Visible workspace changes", 12, 19, 36);
	expect(row(".")).toHaveTextContent("11 of 12");
	expect(row("tools/nested")).toHaveTextContent("1 of 1");
	expect(row("external/empty")).toHaveTextContent("0 of 0");
	expect(row("missing")).toBeInTheDocument();
	expect(screen.getByText("Missing at startup")).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select external" })).not.toBeInTheDocument();
	totals("src/transition visible subtree", 2, 3, 7);
	expect(row("old")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "base codebase boundary: old-owner" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "current codebase boundary: application" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "current repository boundary: tools/nested" })).toBeInTheDocument();
	expect(row("__proto__")).toBeInTheDocument();
	expect(row("tests/reset.ts")).toHaveAttribute("data-importance", "medium");
	expect(screen.queryByRole("button", { name: "Select docs/hidden.md" })).not.toBeInTheDocument();

	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Low" }));
	totals("Visible workspace changes", 10, 10, 25);
	expect(row("tools/nested")).toHaveTextContent("0 of 1");
	expect(screen.queryByRole("button", { name: "Select tests/sample.ts" })).not.toBeInTheDocument();
	expect(row("tests/reset.ts")).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Code" }));
	totals("Visible workspace changes", 3, 4, 6);
	totals("src/transition visible subtree", 1, 1, 5);
	await user.click(screen.getByRole("button", { name: "None" }));
	totals("Visible workspace changes", 4, 4, 13);
	expect(row("docs/hidden.md")).toBeInTheDocument();
	totals("All workspace changes", 13, 19, 43);
});

it("selects and clears both dimensions together while preserving zero-line and binary changed entries", async () => {
	start();
	await screen.findByRole("button", { name: "Select src/zero.ts" });
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Deselect all types and importance levels" }));
	totals("Visible workspace changes", 0, 0, 0);
	expect(row(".")).toHaveTextContent("0 of 12");
	expect(row("tools/nested")).toHaveTextContent("0 of 1");
	expect(screen.queryByRole("button", { name: "Select src/zero.ts" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Select all types and importance levels" }));
	totals("Visible workspace changes", 13, 19, 43);
	expect(row("src/zero.ts")).toBeInTheDocument();
	expect(row("src/moved.ts")).toBeInTheDocument();
	expect(row("assets/logo.png")).toBeInTheDocument();
	expect(row("docs/hidden.md")).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Select src/transition" }));
	const details = screen.getByRole("region", { name: "Selection details" });
	expect(details).toHaveTextContent(/modified/i);
	expect(details).toHaveTextContent("directory");
	await user.click(screen.getByRole("button", { name: "Select src/moved.ts" }));
	expect(details).toHaveTextContent("old/moved.ts");
	expect(details).toHaveTextContent("old-owner");
	expect(details).toHaveTextContent("application");
});

it("explains exact visible line totals using independent Type and Importance breakdowns", async () => {
	start();
	await screen.findByRole("button", { name: "Select src/high.ts" });
	const user = userEvent.setup();
	await user.hover(totals("Visible workspace changes", 12, 19, 36));
	const tooltip = await screen.findByRole("tooltip");
	expect(tooltip).toHaveTextContent("Code");
	expect(tooltip).toHaveTextContent("Tests");
	// The Code row includes explicit code classification under a Tests directory.
	const code = within(tooltip).getByText("Code").closest("tr");
	expect(code).toHaveTextContent("19");
	expect(code).toHaveTextContent("6");
	const high = within(tooltip).getByText("High").closest("tr");
	expect(high).toHaveTextContent("10");
	expect(high).toHaveTextContent("2");
	expect(within(tooltip).queryByText("None")).not.toBeInTheDocument();
});
