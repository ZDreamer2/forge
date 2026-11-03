// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it } from "vitest";
import { ForgeTheme } from "../../ForgeTheme/ForgeTheme";
import { ChangesNavigator } from "../Components/ChangesNavigator/ChangesNavigator";
import { SelectionViewer } from "../Components/SelectionViewer/SelectionViewer";
import { analyzeChanges, initialFilters } from "../Internal/changeAnalysis";
import { WorkspaceReview } from "../WorkspaceReview";

const suite = createTestSuiteLifecycle({
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [() => cleanup()],
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

it("inspects canonical transitions, filtered entries and repository scopes without mounting a navigator", () => {
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
	const review = analyzeChanges(facts, identity, initialFilters());
	const view = (path: string, model = review) => (
		<ForgeTheme env="test">
			<SelectionViewer review={model} selectedPath={path} />
		</ForgeTheme>
	);
	const rendered = render(view("."));
	const details = within(screen.getByRole("region", { name: "Selection details" }));
	expect(details.getByText(/3 visible changed files/)).toHaveTextContent("of 4 in this subtree");
	expect(
		details.getByRole("button", { name: ". visible subtree: 3 changed files, 1 removed lines, 2 added lines" }),
	).toBeInTheDocument();
	expect(details.getByText(/Repository-owned changes: 2 of 3/)).toBeInTheDocument();

	rendered.rerender(view("transition"));
	expect(details.getByText(/1 visible changed files/)).toHaveTextContent("of 2 in this subtree");
	expect(details.getByRole("region", { name: "Selected entry metadata" })).toHaveTextContent("Deleted entry");
	expect(details.getByText(/Own change: 1 removed lines, 2 added lines/)).toBeInTheDocument();
	rendered.rerender(view("transition/hidden.md"));
	expect(details.getByRole("status")).toHaveTextContent("outside the current filters");
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

it("owns initial/new expansion and reveals an address once, not again on placeholder reparenting", async () => {
	const user = userEvent.setup();
	const filters = initialFilters();
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
		);
	}
	const rendered = render(view(first, "a/new/empty"));
	expect(screen.getByRole("button", { name: "Select a/keep.ts" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	rendered.rerender(view(refreshed, "a/new/empty"));
	expect(screen.getByRole("button", { name: "Expand a" })).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select a/new/file.ts" })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Expand a" }));
	expect(screen.getByRole("button", { name: "Collapse a/new" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select a/new/file.ts" })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Collapse a" }));
	rendered.rerender(view(refreshed, "."));
	rendered.rerender(view(refreshed, "a/new/empty"));
	expect(screen.getByRole("button", { name: "Collapse a" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select a/new/empty", pressed: true })).toBeInTheDocument();
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
			<ForgeTheme env="test">
				<WorkspaceReview selectedPath="src/file.ts" onNavigate={() => {}} />
			</ForgeTheme>
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
