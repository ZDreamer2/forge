// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceIdentity } from "@forge/api-contract";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it, vi } from "vitest";
import { fileHandler } from "../../../Lib/Testing/Testing";
import { ForgeTheme } from "../../ForgeTheme/ForgeTheme";
import { ChangesNavigator } from "../Components/ChangesNavigator/ChangesNavigator";
import { SelectionViewer } from "../Components/SelectionViewer/SelectionViewer";
import { analyzeChanges, initialFilters } from "../Internal/changeAnalysis";
import type { WorkspaceAnalysis } from "../Internal/guidance";
import { analyzeSignals } from "../Internal/signalAnalysis";
import { WorkspaceReview } from "../WorkspaceReview";

vi.mock("../Components/SelectionViewer/Components/FileDiff/Internal/pierreRenderer", async () =>
	(await import("../../../Lib/Testing/Testing")).rendererBoundary(),
);

let client: QueryClient;
let viewportDescriptor: PropertyDescriptor | undefined;
const suite = createTestSuiteLifecycle({
	prepare() {
		client = suite.createQueryClient();
		viewportDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
	},
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [
		() => cleanup(),
		() => {
			vi.restoreAllMocks();
			if (viewportDescriptor) Object.defineProperty(window, "innerWidth", viewportDescriptor);
		},
	],
	runCleanup: (finish) => act(finish),
});

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
function analysis(entries: AnalysisWireNode[]): WorkspaceAnalysis {
	return {
		root: ".",
		nodes: Object.fromEntries(entries.map((entry) => [entry.path, entry])),
		codebases: {},
		guidance: { workspace: [], codebases: {} },
		handlers: {},
	};
}
const identity: WorkspaceIdentity = {
	workspace: { name: "Review", root: "/fixture" },
	repositories: [
		{ path: ".", status: "available", gitRoot: "/fixture" },
		{ path: "nested", status: "available", gitRoot: "/fixture/nested" },
		{ path: "missing", status: "missing" },
	],
};

it("deduplicates codebase boundaries beside names, removes repository badges and retains differing side guide details", async () => {
	const side = {
		path: "target",
		kind: "directory" as const,
		repository: ".",
		repositoryRoot: ".",
		codebase: "target",
		codebaseRoot: "target",
	};
	const facts = analysis([
		node(".", { children: ["target"] }),
		node("target", { base: side, current: side, children: ["target/a.ts"] }),
		node("target/a.ts", { kind: "modified" }),
	]);
	facts.codebases = {
		target: { id: "actual-id", root: "target", guidance: "guides/target" },
		old: { id: "previous-id", root: "old", guidance: "guides/old" },
	};
	const filters = initialFilters();
	const view = () => (
		<ForgeTheme env="test">
			<ChangesNavigator
				review={analyzeChanges(facts, undefined, filters)}
				analysis={facts}
				identity={identity}
				filters={filters}
				onFiltersChange={() => {}}
				selectedPath={undefined}
				onSelect={() => {}}
			/>
		</ForgeTheme>
	);
	const rendered = render(view());
	expect(screen.getAllByRole("button", { name: "Codebase boundary: actual-id" })).toHaveLength(1);
	expect(screen.queryByRole("button", { name: /repository boundary/ })).not.toBeInTheDocument();
	const user = userEvent.setup();
	await user.hover(screen.getByRole("button", { name: "Codebase boundary: actual-id" }));
	expect(await screen.findByRole("tooltip")).toHaveTextContent("actual-id codebaseGuide: guides/target");
	expect(screen.getByRole("tooltip")).not.toHaveTextContent("Current");
	await user.unhover(screen.getByRole("button", { name: "Codebase boundary: actual-id" }));
	const target = facts.nodes.target;
	if (!target) throw new Error("Missing fixture target");
	target.base = { ...side, path: "old", codebase: "old", codebaseRoot: "old" };
	rendered.rerender(view());
	await user.hover(screen.getByRole("button", { name: "Codebase boundary: previous-id, actual-id" }));
	expect(await screen.findByRole("tooltip")).toHaveTextContent("Base: previous-id codebaseGuide: guides/old");
	expect(screen.getByRole("tooltip")).toHaveTextContent("Current: actual-id codebaseGuide: guides/target");
});

it("inspects canonical transitions, filtered entries and inclusive subtrees without mounting a navigator", () => {
	const facts = analysis([
		node(".", { children: ["transition", "nested", "__proto__"] }),
		node("transition", {
			children: ["transition/hidden.md"],
			kind: "deleted",
			repo: ".",
			base: { path: "transition", kind: "file", repository: "." },
			current: { path: "transition", kind: "directory", repository: "." },
			statistics: { added: 2, removed: 1, binary: false },
		}),
		node("transition/hidden.md", {
			kind: "added",
			repo: ".",
			classification: { value: "docs" },
			effectiveEmphasis: { value: "hidden" },
			statistics: { added: 5, removed: 2, binary: false },
		}),
		node("nested", { kind: "modified", repo: "nested", statistics: { added: 99, removed: 99, binary: true } }),
		node("__proto__", {
			kind: "renamed",
			from: "old-name",
			repo: ".",
			statistics: { added: 0, removed: 0, binary: false },
		}),
	]);
	suite.createHttpScenario(fileHandler(facts));
	const review = analyzeChanges(facts, identity, initialFilters());
	const view = (path: string, model = review) => (
		<QueryClientProvider client={client}>
			<ForgeTheme env="test">
				<SelectionViewer onRefresh={() => {}} review={model} selectedPath={path} />
			</ForgeTheme>
		</QueryClientProvider>
	);
	const rendered = render(view("."));
	const details = within(screen.getByRole("region", { name: "Selection details" }));
	expect(details.getByText("3 of 4 files")).toBeInTheDocument();
	expect(details.getAllByRole("img", { name: "3 files, 2 added lines, 1 removed lines" }).length).toBeGreaterThan(0);

	expect(details.getByRole("table", { name: "Matching changes by type and importance" })).toBeInTheDocument();
	rendered.rerender(view("transition"));
	expect(details.getByText("1 of 2 files")).toBeInTheDocument();
	expect(details.getByRole("region", { name: "Selected entry metadata" })).toHaveTextContent("Deleted entry");
	expect(details.getByText(/Own change: 1 removed lines, 2 added lines/)).toBeInTheDocument();
	rendered.rerender(view("transition/hidden.md"));
	expect(details.getByText(/outside the current filters/)).toHaveAttribute("role", "status");
	expect(details.getByText("Docs")).toBeInTheDocument();
	expect(details.getByText("None")).toBeInTheDocument();
	rendered.rerender(view("__proto__"));
	expect(details.getByRole("heading", { name: "__proto__" })).toBeInTheDocument();
	expect(details.getByText(/No line changes were reported/)).toBeInTheDocument();
	rendered.rerender(view("nested"));
	expect(details.getByText("Binary change. Line totals are unavailable.")).toBeInTheDocument();

	const empty = analyzeChanges(analysis([node(".")]), identity, initialFilters());
	rendered.rerender(view("nested", empty));
	expect(details.getByRole("heading", { name: "nested" })).toBeInTheDocument();
	expect(details.getByText("No changed entries in this subtree.")).toBeInTheDocument();
	rendered.rerender(view("missing", empty));
	expect(details.getByText("This repository was unavailable when the server started.")).toBeInTheDocument();
});

it("prunes empty and filtered repositories while retaining canonical ancestors of matching repositories", async () => {
	const user = userEvent.setup();
	const repositories: WorkspaceIdentity = {
		...identity,
		repositories: identity.repositories.filter((repository) => repository.status === "available"),
	};
	const filters = initialFilters();
	function view(facts: WorkspaceAnalysis) {
		return (
			<ForgeTheme env="test">
				<ChangesNavigator
					review={analyzeChanges(facts, repositories, filters)}
					analysis={facts}
					identity={repositories}
					filters={filters}
					onFiltersChange={() => {}}
					selectedPath={undefined}
					onSelect={() => {}}
				/>
			</ForgeTheme>
		);
	}
	const rendered = render(view(analysis([node(".")])));
	expect(screen.queryByRole("button", { name: "Select ." })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select nested" })).not.toBeInTheDocument();
	expect(within(screen.getByRole("navigation", { name: "Changed files" })).getByText("No changes")).toBeInTheDocument();
	rendered.rerender(
		view(
			analysis([
				node(".", { children: ["nested"] }),
				node("nested", { children: ["nested/hidden.ts"] }),
				node("nested/hidden.ts", { kind: "added", repo: "nested", effectiveEmphasis: { value: "hidden" } }),
			]),
		),
	);
	expect(screen.queryByRole("button", { name: "Select ." })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select nested" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select nested/hidden.ts" })).not.toBeInTheDocument();
	expect(
		within(screen.getByRole("navigation", { name: "Changed files" })).getByText("No changes match the filters"),
	).toBeInTheDocument();
	rendered.rerender(
		view(
			analysis([
				node(".", { children: ["tools"] }),
				node("tools", { children: ["tools/repository"] }),
				node("tools/repository", {
					children: ["tools/repository/file.ts"],
					current: {
						path: "tools/repository",
						kind: "directory",
						repository: "tools/repository",
						repositoryRoot: "tools/repository",
					},
				}),
				node("tools/repository/file.ts", { kind: "added", repo: "tools/repository" }),
			]),
		),
	);
	expect(screen.getByRole("button", { name: "Select ." })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select tools" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select tools/repository" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select tools/repository/file.ts" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse tools" }));
	expect(screen.queryByRole("button", { name: "Select tools/repository" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand tools" }));
	expect(screen.getByRole("button", { name: "Select tools/repository/file.ts" })).toBeInTheDocument();
});

it("retains manual collapse through new descendants and filter hide/restore without reopening a selected branch", async () => {
	const user = userEvent.setup();
	let filters = initialFilters();
	const repositories: WorkspaceIdentity = {
		...identity,
		repositories: [{ path: "a/new/empty", status: "available", gitRoot: "/fixture/a/new/empty" }],
	};
	const first = analysis([
		node(".", { children: ["a"] }),
		node("a", { children: ["a/keep.ts"] }),
		node("a/keep.ts", { kind: "modified" }),
	]);
	const refreshed = analysis([
		node(".", { children: ["a"] }),
		node("a", { children: ["a/keep.ts", "a/new"] }),
		node("a/keep.ts", { kind: "modified" }),
		node("a/new", { children: ["a/new/file.ts"] }),
		node("a/new/file.ts", { kind: "added" }),
	]);
	function view(facts: WorkspaceAnalysis, selectedPath: string | undefined) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<ChangesNavigator
						review={analyzeChanges(facts, repositories, filters)}
						analysis={facts}
						identity={repositories}
						filters={filters}
						onFiltersChange={() => {}}
						selectedPath={selectedPath}
						onSelect={() => {}}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view(first, "a/keep.ts"));
	expect(screen.getByRole("button", { name: "Select a/keep.ts" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	filters = { ...filters, types: new Set() };
	rendered.rerender(view(first, "a/keep.ts"));
	expect(screen.queryByRole("button", { name: "Select a" })).not.toBeInTheDocument();
	filters = initialFilters();
	rendered.rerender(view(refreshed, "a/keep.ts"));
	expect(screen.getByRole("button", { name: "Expand a" })).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select a/new/file.ts" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand a" }));
	expect(screen.getByRole("button", { name: "Collapse a/new" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select a/new/file.ts" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	rendered.rerender(view(refreshed, "."));
	rendered.rerender(view(refreshed, "a/new/file.ts"));
	expect(screen.getByRole("button", { name: "Collapse a" })).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select a/new/empty" })).not.toBeInTheDocument();
});

it("reveals a pending address on first resolution without revealing it again on later observations", async () => {
	const user = userEvent.setup();
	const filters = initialFilters();
	const first = analysis([
		node(".", { children: ["src"] }),
		node("src", { children: ["src/old.ts"] }),
		node("src/old.ts", { kind: "modified" }),
	]);
	const resolved = analysis([
		node(".", { children: ["src"] }),
		node("src", { children: ["src/new.ts"] }),
		node("src/new.ts", { kind: "added" }),
	]);
	function view(facts: WorkspaceAnalysis) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<ChangesNavigator
						review={analyzeChanges(facts, undefined, filters)}
						analysis={facts}
						identity={undefined}
						filters={filters}
						onFiltersChange={() => {}}
						selectedPath="src/new.ts"
						onSelect={() => {}}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view(first));
	await user.click(screen.getByRole("button", { name: "Collapse src" }));
	rendered.rerender(view(resolved));
	expect(screen.getByRole("button", { name: "Select src/new.ts", pressed: true })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse src" }));
	rendered.rerender(view(resolved));
	expect(screen.getByRole("button", { name: "Expand src" })).toBeInTheDocument();
});

it("coordinates both public data owners while retaining filters, disclosure, selection and divider width", async () => {
	const user = userEvent.setup();
	let identityReads = 0;
	let analysisReads = 0;
	const facts = analysis([
		node(".", { children: ["src"] }),
		node("src", { children: ["src/file.ts"] }),
		node("src/file.ts", { kind: "modified", statistics: { added: 1, removed: 0, binary: false } }),
	]);
	suite.createHttpScenario(
		fileHandler(facts),
		http.get("http://localhost/api/workspace", () => {
			identityReads++;
			return Response.json(identity);
		}),
		http.get("http://localhost/api/changes/analysis", () => {
			analysisReads++;
			return Response.json(facts);
		}),
	);
	render(
		<QueryClientProvider client={suite.createQueryClient()}>
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<WorkspaceReview selectedPath="src/file.ts" onNavigate={() => {}} />
				</ForgeTheme>
			</QueryClientProvider>
		</QueryClientProvider>,
	);
	await screen.findByRole("button", { name: "Select src/file.ts", pressed: true });
	await user.click(screen.getByRole("button", { name: "Docs", pressed: true }));
	await user.click(screen.getByRole("button", { name: "Collapse src" }));
	const divider = screen.getByRole("separator", { name: "Resize changes sidebar" });
	divider.focus();
	await user.keyboard("{ArrowLeft}");
	const width = divider.getAttribute("aria-valuenow");
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
	expect(identityReads).toBe(2);
	expect(analysisReads).toBe(2);
	expect(screen.getByRole("button", { name: "Docs", pressed: false })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand src" })).toBeInTheDocument();
	expect(screen.getByRole("heading", { name: "src/file.ts" })).toBeInTheDocument();
	expect(divider).toHaveAttribute("aria-valuenow", width);
});

it("consumes explicit same-path reveals once while preserving unrelated collapsed branches", async () => {
	const user = userEvent.setup();
	const filters = initialFilters();
	const facts = analysis([
		node(".", { children: ["a", "b"] }),
		node("a", { children: ["a/file.ts"] }),
		node("a/file.ts", { kind: "modified" }),
		node("b", { children: ["b/file.ts"] }),
		node("b/file.ts", { kind: "added" }),
	]);
	function view(occurrence?: number) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<ChangesNavigator
						review={analyzeChanges(facts, undefined, filters)}
						analysis={facts}
						identity={undefined}
						filters={filters}
						onFiltersChange={() => {}}
						selectedPath="a/file.ts"
						onSelect={() => {}}
						revealRequest={occurrence === undefined ? undefined : { path: "a/file.ts", occurrence }}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view());
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	await user.click(screen.getByRole("button", { name: "Collapse b" }));
	rendered.rerender(view(1));
	expect(screen.getByRole("button", { name: "Select a/file.ts", pressed: true })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand b" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	rendered.rerender(view(1));
	expect(screen.getByRole("button", { name: "Expand a" })).toBeInTheDocument();
	rendered.rerender(view(2));
	expect(screen.getByRole("button", { name: "Select a/file.ts", pressed: true })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand b" })).toBeInTheDocument();
});

it("invalidates an unresolved reveal when a newer address supersedes its target", async () => {
	const user = userEvent.setup();
	const filters = initialFilters();
	const first = analysis([
		node(".", { children: ["a", "b"] }),
		node("a", { children: ["a/old.ts"] }),
		node("a/old.ts", { kind: "modified" }),
		node("b", { children: ["b/file.ts"] }),
		node("b/file.ts", { kind: "added" }),
	]);
	const resolved = analysis([
		node(".", { children: ["a", "b"] }),
		node("a", { children: ["a/old.ts", "a/late.ts"] }),
		node("a/old.ts", { kind: "modified" }),
		node("a/late.ts", { kind: "added" }),
		node("b", { children: ["b/file.ts"] }),
		node("b/file.ts", { kind: "added" }),
	]);
	function view(facts: WorkspaceAnalysis, selectedPath: string, occurrence: number, target: string) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<ChangesNavigator
						review={analyzeChanges(facts, undefined, filters)}
						analysis={facts}
						identity={undefined}
						filters={filters}
						onFiltersChange={() => {}}
						selectedPath={selectedPath}
						onSelect={() => {}}
						revealRequest={{ path: target, occurrence }}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view(first, "a/late.ts", 1, "a/late.ts"));
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	rendered.rerender(view(first, "b/file.ts", 2, "b/file.ts"));
	rendered.rerender(view(resolved, "b/file.ts", 2, "b/file.ts"));
	expect(screen.getByRole("button", { name: "Expand a" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select b/file.ts", pressed: true })).toBeInTheDocument();
});

it("owns signal disclosure and canonical source access independently of a navigator", async () => {
	const user = userEvent.setup();
	const sources: string[] = [];
	const reveals: string[] = [];
	const facts = analysis([
		node(".", { children: ["transition"] }),
		node("transition", {
			kind: "deleted",
			base: { path: "transition", kind: "file" },
			current: { path: "transition", kind: "directory" },
			children: ["transition/hidden.md"],
			signals: [{ severity: "warning", message: "Direct transition", handler: "workspace" }],
			signalCounts: { warning: 1, notice: 1 },
		}),
		node("transition/hidden.md", {
			kind: "added",
			classification: { value: "docs" },
			effectiveEmphasis: { value: "hidden" },
			signals: [{ severity: "notice", message: "Hidden descendant", handler: "codebase:docs" }],
			signalCounts: { warning: 0, notice: 1 },
		}),
	]);
	suite.createHttpScenario(fileHandler(facts));
	function view(path: string, occurrence?: number) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<SelectionViewer
						onRefresh={() => {}}
						review={analyzeChanges(facts, identity, initialFilters())}
						signals={analyzeSignals(facts)}
						selectedPath={path}
						inspectionRequest={occurrence === undefined ? undefined : { path, occurrence }}
						onSourceNavigate={(source) => sources.push(source)}
						onReveal={(source) => reveals.push(source)}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view("transition"));
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Show signal details" }));
	const details = within(screen.getByRole("region", { name: "Signal details" }));
	expect(details.getByText("Direct transition")).toBeInTheDocument();
	expect(details.getByText("Hidden descendant")).toBeInTheDocument();
	expect(details.queryByRole("button", { name: "Reveal file transition" })).not.toBeInTheDocument();
	await user.click(details.getByRole("button", { name: "Inspect source transition" }));
	await user.click(details.getByRole("button", { name: "Reveal file transition/hidden.md" }));
	expect(sources).toEqual(["transition"]);
	expect(reveals).toEqual(["transition/hidden.md"]);
	await user.click(screen.getByRole("button", { name: "Hide signal details" }));
	rendered.rerender(view("transition", 1));
	expect(screen.getByRole("region", { name: "Signal details" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Hide signal details" }));
	rendered.rerender(view("transition", 1));
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
	rendered.rerender(view("missing", 2));
	expect(
		screen.queryByRole("button", { name: /Inspect warnings|Inspect notices|Show signal details/ }),
	).not.toBeInTheDocument();
});

it("does not reopen viewer details for an obsolete unresolved inspection", async () => {
	const user = userEvent.setup();
	const first = analysis([
		node(".", { children: ["current"] }),
		node("current", {
			kind: "modified",
			signals: [{ severity: "notice", message: "Current concern", handler: "workspace" }],
			signalCounts: { warning: 0, notice: 1 },
		}),
	]);
	const resolved = analysis([
		...Object.values(first.nodes),
		node("late", {
			kind: "added",
			signals: [{ severity: "warning", message: "Obsolete concern", handler: "workspace" }],
			signalCounts: { warning: 1, notice: 0 },
		}),
	]);
	suite.createHttpScenario(fileHandler(resolved));
	function view(facts: WorkspaceAnalysis, path: string, occurrence: number, target: string) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<SelectionViewer
						onRefresh={() => {}}
						review={analyzeChanges(facts, identity, initialFilters())}
						signals={analyzeSignals(facts)}
						selectedPath={path}
						inspectionRequest={{ path: target, occurrence }}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view(first, "late", 1, "late"));
	rendered.rerender(view(first, "current", 2, "current"));
	expect(screen.getByRole("region", { name: "Signal details" })).toHaveTextContent("Current concern");
	await user.click(screen.getByRole("button", { name: "Hide signal details" }));
	rendered.rerender(view(resolved, "current", 2, "current"));
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
});

it("invalidates pending inspection after leaving its addressed target even when returning to the origin", async () => {
	const initial = analysis([node(".", { children: ["current"] }), node("current", { kind: "modified" })]);
	const resolved = analysis([
		node(".", { children: ["current", "late"] }),
		node("current", { kind: "modified" }),
		node("late", {
			kind: "added",
			signals: [{ severity: "warning", message: "Late concern", handler: "workspace" }],
			signalCounts: { notice: 0, warning: 1 },
		}),
	]);
	suite.createHttpScenario(fileHandler(resolved));
	function view(facts: WorkspaceAnalysis, path: string) {
		return (
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<SelectionViewer
						onRefresh={() => {}}
						review={analyzeChanges(facts, identity, initialFilters())}
						signals={analyzeSignals(facts)}
						selectedPath={path}
						inspectionRequest={{ path: "late", occurrence: 1 }}
					/>
				</ForgeTheme>
			</QueryClientProvider>
		);
	}
	const rendered = render(view(initial, "current"));
	rendered.rerender(view(initial, "late"));
	rendered.rerender(view(initial, "current"));
	rendered.rerender(view(resolved, "late"));
	expect(screen.getByRole("button", { name: "Show signal details" })).toBeInTheDocument();
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
});

it("restores the sidebar preference across remounts without losing it to temporary viewport bounds", async () => {
	const user = userEvent.setup();
	const facts = analysis([node(".")]);
	suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => Response.json(identity)),
		http.get("http://localhost/api/changes/analysis", () => Response.json(facts)),
	);
	function mount() {
		return render(
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<WorkspaceReview onNavigate={() => {}} />
				</ForgeTheme>
			</QueryClientProvider>,
		);
	}
	window.localStorage.setItem("forge-sidebar-width", "510");
	let rendered = mount();
	let divider = screen.getByRole("separator", { name: "Resize changes sidebar" });
	expect(divider).toHaveAttribute("aria-valuenow", "510");
	divider.focus();
	await user.keyboard("{ArrowLeft}");
	expect(divider).toHaveAttribute("aria-valuenow", "490");
	expect(window.localStorage.getItem("forge-sidebar-width")).toBe("490");
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
	act(() => window.dispatchEvent(new Event("resize")));
	expect(divider).toHaveAttribute("aria-valuenow", "360");
	expect(window.localStorage.getItem("forge-sidebar-width")).toBe("490");
	rendered.unmount();
	rendered = mount();
	divider = screen.getByRole("separator", { name: "Resize changes sidebar" });
	expect(divider).toHaveAttribute("aria-valuenow", "360");
	Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
	act(() => window.dispatchEvent(new Event("resize")));
	expect(divider).toHaveAttribute("aria-valuenow", "490");
	rendered.unmount();
	for (const saved of ["", " ", "not-a-width", "Infinity", "0", "-20"]) {
		window.localStorage.setItem("forge-sidebar-width", saved);
		rendered = mount();
		expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "390");
		rendered.unmount();
	}
	for (const [saved, displayed] of [
		["1", "240"],
		["900", "600"],
	] as const) {
		window.localStorage.setItem("forge-sidebar-width", saved);
		rendered = mount();
		expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", displayed);
		expect(window.localStorage.getItem("forge-sidebar-width")).toBe(saved);
		rendered.unmount();
	}
});

it("keeps resizing usable when storage access, reads or writes are blocked", async () => {
	const user = userEvent.setup();
	const facts = analysis([node(".")]);
	suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => Response.json(identity)),
		http.get("http://localhost/api/changes/analysis", () => Response.json(facts)),
	);
	for (const failure of ["access", "read", "write"]) {
		window.localStorage.removeItem("forge-sidebar-width");
		const blocked = () => {
			throw new DOMException("Storage blocked", "SecurityError");
		};
		if (failure === "access") vi.spyOn(window, "localStorage", "get").mockImplementation(blocked);
		if (failure === "read") vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
		if (failure === "write") vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
		const rendered = render(
			<QueryClientProvider client={client}>
				<ForgeTheme env="test">
					<WorkspaceReview onNavigate={() => {}} />
				</ForgeTheme>
			</QueryClientProvider>,
		);
		const divider = screen.getByRole("separator", { name: "Resize changes sidebar" });
		expect(divider).toHaveAttribute("aria-valuenow", "390");
		divider.focus();
		await user.keyboard("{ArrowRight}");
		expect(divider).toHaveAttribute("aria-valuenow", "410");
		await user.keyboard("{ArrowLeft}{ArrowLeft}");
		expect(divider).toHaveAttribute("aria-valuenow", "370");
		rendered.unmount();
		vi.restoreAllMocks();
	}
});
