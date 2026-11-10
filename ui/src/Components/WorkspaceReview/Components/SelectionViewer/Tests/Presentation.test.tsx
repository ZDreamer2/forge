// @vitest-environment jsdom
import type { AnalysisWireNode } from "@forge/api-contract";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { expect, it, vi } from "vitest";
import { ForgeTheme } from "../../../../ForgeTheme/ForgeTheme";
import { analyzeChanges, initialFilters } from "../../../Internal/changeAnalysis";
import type { GuidanceEntry, WorkspaceAnalysis, WorkspaceGuidance } from "../../../Internal/guidance";
import { FolderContext } from "../Components/FolderContext/FolderContext";
import { PathHeader } from "../Components/PathHeader/PathHeader";
import { SelectionViewer } from "../SelectionViewer";

createTestSuiteLifecycle({
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [
		() => {
			window.getSelection()?.removeAllRanges();
			cleanup();
		},
	],
	runCleanup: (finish) => act(finish),
});
const shared: GuidanceEntry = {
	id: "codebase:shared",
	name: "shared",
	guidance: "/outside/guides/shared",
	source: "workspace-parent",
};
const workspace: GuidanceEntry = {
	id: "workspace",
	name: "Example workspace",
	root: ".",
	guidance: "docs/forge/workspace",
	source: "workspace",
};
const project: GuidanceEntry = {
	id: "codebase:project",
	name: "project",
	root: "outer/project",
	guidance: "guides/project",
	source: "project-folder",
};
const guidance: WorkspaceGuidance = {
	workspace: [shared, workspace],
	codebases: {
		outer: [{ ...project, id: "codebase:physical", name: "physical-not-inherited", root: "outer" }],
		"outer/project": [
			shared,
			workspace,
			{ id: "codebase:policy", name: "policy", guidance: "guides/policy", source: "project-parent" },
			project,
		],
	},
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
function subject(extra: Partial<AnalysisWireNode> = {}) {
	const side = { path: "outer/project", kind: "directory" as const, repository: ".", codebase: "outer/project" };
	const facts: WorkspaceAnalysis = {
		root: ".",
		codebases: {},
		handlers: {},
		guidance,
		nodes: {
			".": node(".", { children: ["outer/project"] }),
			"outer/project": node("outer/project", { base: side, current: side, ...extra }),
		},
	};
	const selected = analyzeChanges(facts, undefined, initialFilters()).subjects.get("outer/project");
	if (!selected) throw new Error("Missing fixture subject");
	return selected;
}

it("presents authoritative guidance exactly once in API order, independently of physical ancestry, and roots navigate without toggling", async () => {
	const navigate = vi.fn();
	render(
		<ForgeTheme env="test">
			<FolderContext selected={subject()} guidance={guidance} onNavigate={navigate} />
		</ForgeTheme>,
	);
	const table = within(screen.getByRole("table", { name: "Forge guidance" }));
	expect(table.getAllByRole("rowheader").map((row) => row.textContent)).toEqual([
		"shared",
		"Example workspace",
		"policy",
		"project",
	]);
	expect(table.getByRole("row", { name: "shared Workspace parent —" })).toBeInTheDocument();
	expect(table.getByRole("row", { name: "policy Project parent —" })).toBeInTheDocument();
	expect(screen.queryByText("physical-not-inherited")).not.toBeInTheDocument();
	expect(screen.queryByRole("region", { name: "Base context" })).not.toBeInTheDocument();
	const user = userEvent.setup();
	await user.hover(table.getByText("shared"));
	expect(await screen.findByRole("tooltip")).toHaveTextContent("Guide: /outside/guides/shared");
	await user.unhover(table.getByText("shared"));
	await user.click(table.getByRole("button", { name: "outer/project" }));
	await user.click(table.getByRole("button", { name: "outer/project" }));
	expect(navigate.mock.calls).toEqual([["outer/project"], ["outer/project"]]);
	await user.click(table.getByRole("button", { name: "Workspace" }));
	expect(navigate).toHaveBeenLastCalledWith(".");
});

it("keeps differing side ownership separate and labels a file/directory transition honestly", () => {
	render(
		<ForgeTheme env="test">
			<FolderContext
				selected={subject({ base: { path: "old", kind: "file", repository: "old-repo", codebase: "outer" } })}
				guidance={guidance}
			/>
		</ForgeTheme>,
	);
	const base = within(screen.getByRole("region", { name: "Base context" }));
	const current = within(screen.getByRole("region", { name: "Current context" }));
	expect(base.getByRole("heading", { name: "Base · file" })).toBeInTheDocument();
	expect(base.getByRole("button", { name: "old-repo" })).toBeInTheDocument();
	expect(base.getByText("physical-not-inherited")).toBeInTheDocument();
	expect(base.queryByText("shared")).not.toBeInTheDocument();
	expect(current.getByText("shared")).toBeInTheDocument();
	expect(current.queryByText("physical-not-inherited")).not.toBeInTheDocument();
});

it("does not invent absent-side guidance or silently fall back for an unknown owner", () => {
	const selected = subject({ current: { path: "outer/project", kind: "directory", codebase: "unknown" } });
	if (!selected.node) throw new Error("Missing fixture node");
	delete selected.node.base;
	render(
		<ForgeTheme env="test">
			<FolderContext selected={selected} guidance={guidance} />
		</ForgeTheme>,
	);
	expect(screen.queryByRole("region", { name: "Base context" })).not.toBeInTheDocument();
	expect(screen.getByRole("region", { name: "Current context" })).toHaveTextContent("Guidance context is unavailable.");
	expect(screen.queryByText("shared")).not.toBeInTheDocument();
});

it("copies full path prefixes by click and keyboard, and displays Workspace while copying dot", async () => {
	const copy = vi.fn();
	const user = userEvent.setup();
	const view = render(
		<ForgeTheme env="test">
			<PathHeader path="src/deep/file.ts" onCopy={copy} />
		</ForgeTheme>,
	);
	await user.click(screen.getByRole("button", { name: "Copy src" }));
	await user.click(screen.getByRole("button", { name: "Copy src/deep" }));
	await user.click(screen.getByRole("button", { name: "Copy src/deep/file.ts" }));
	expect(copy.mock.calls).toEqual([["src"], ["src/deep"], ["src/deep/file.ts"]]);
	await user.keyboard("{Enter} ");
	expect(copy).toHaveBeenCalledTimes(5);
	expect(await screen.findByRole("tooltip")).toHaveTextContent("Drag to select text.");
	view.rerender(
		<ForgeTheme env="test">
			<PathHeader path="." onCopy={copy} />
		</ForgeTheme>,
	);
	expect(screen.getByRole("heading", { name: "." })).toHaveTextContent("Workspace");
	await user.click(screen.getByRole("button", { name: "Copy ." }));
	expect(copy).toHaveBeenLastCalledWith(".");
});

it("suppresses copying for drags across segments and a selection that existed before pointer down", () => {
	const copy = vi.fn();
	render(
		<ForgeTheme env="test">
			<PathHeader path="src/deep/file.ts" onCopy={copy} />
		</ForgeTheme>,
	);
	const first = screen.getByRole("button", { name: "Copy src" });
	const last = screen.getByRole("button", { name: "Copy src/deep/file.ts" });
	fireEvent.pointerDown(first, { button: 0, clientX: 0, clientY: 0 });
	fireEvent.pointerMove(document, { clientX: 20, clientY: 0 });
	fireEvent.pointerUp(last);
	fireEvent.click(first, { detail: 1 });
	expect(copy).not.toHaveBeenCalled();
	const range = document.createRange();
	const start = first.firstChild;
	const end = last.firstChild?.firstChild;
	if (!start || !end) throw new Error("Missing path text");
	range.setStart(start, 0);
	range.setEnd(end, 4);
	window.getSelection()?.addRange(range);
	fireEvent.pointerDown(first, { button: 0 });
	window.getSelection()?.removeAllRanges();
	fireEvent.pointerUp(first);
	fireEvent.click(first, { detail: 1 });
	expect(copy).not.toHaveBeenCalled();
	fireEvent.pointerDown(first, { button: 0 });
	fireEvent.pointerUp(first);
	fireEvent.click(first, { detail: 1 });
	expect(copy).toHaveBeenLastCalledWith("src");
});

it("uses matrix totals without duplicate summaries or legend and keeps the filtered/empty denominator", () => {
	const facts: WorkspaceAnalysis = {
		root: ".",
		guidance,
		handlers: {},
		codebases: {},
		nodes: {
			".": node(".", { children: ["a.ts"] }),
			"a.ts": node("a.ts", { kind: "added", statistics: { added: 2, removed: 0, binary: false } }),
		},
	};
	let filters = initialFilters();
	const view = () => (
		<ForgeTheme env="test">
			<SelectionViewer
				review={analyzeChanges(facts, undefined, filters)}
				selectedPath="."
				guidance={guidance}
				onRefresh={() => {}}
			/>
		</ForgeTheme>
	);
	const rendered = render(view());
	const table = within(screen.getByRole("table", { name: "Matching changes by type and importance" }));
	expect(table.getAllByRole("img", { name: "1 files, 2 added lines, 0 removed lines" }).length).toBeGreaterThan(0);
	expect(screen.queryByText("1 of 1 files")).not.toBeInTheDocument();
	expect(screen.queryByText(/matching changed files/)).not.toBeInTheDocument();
	expect(screen.queryByText("Files / added / removed")).not.toBeInTheDocument();
	filters = { ...filters, types: new Set() };
	rendered.rerender(view());
	expect(screen.getByText("0 of 1 files")).toBeInTheDocument();
	expect(screen.getByText("No changes match the current filters.")).toBeInTheDocument();
	expect(screen.queryByRole("table", { name: "Matching changes by type and importance" })).not.toBeInTheDocument();
	expect(screen.getByRole("table", { name: "Forge guidance" })).toBeInTheDocument();
});
