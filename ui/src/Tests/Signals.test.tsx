// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it, vi } from "vitest";
import App from "../App";

const suite = createTestSuiteLifecycle({
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [() => cleanup()],
	runCleanup: (finish) => act(finish),
});
const identity: WorkspaceIdentity = {
	workspace: { name: "Signals workspace", root: "/fixture" },
	repositories: [
		{ path: ".", status: "available", gitRoot: "/fixture" },
		{ path: "nested", status: "available", gitRoot: "/fixture/nested" },
		{ path: "empty", status: "available", gitRoot: "/fixture/empty" },
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
function fixture(): WorkspaceAnalysis {
	const entries = [
		node(".", {
			children: ["src", "nested", "other", "transition"],
			signals: [{ severity: "warning", message: "Repository concern", handler: "workspace" }],
		}),
		node("src", {
			children: ["src/renamed.ts"],
			signals: [{ severity: "notice", message: "Folder concern", handler: "workspace" }],
		}),
		node("src/renamed.ts", {
			kind: "renamed",
			from: "src/former.ts",
			repo: ".",
			base: { path: "src/former.ts", kind: "file", repository: "." },
			current: { path: "src/renamed.ts", kind: "file", repository: "." },
			signals: [
				{
					severity: "warning",
					message: "Repeated concern",
					handler: "workspace",
					location: { side: "base", line: 7, column: 3 },
				},
				{ severity: "warning", message: "Repeated concern", handler: "codebase:second" },
			],
		}),
		node("nested", {
			children: ["nested/hidden.md"],
			current: { path: "nested", kind: "directory", repository: "nested", repositoryRoot: "nested" },
			signals: [{ severity: "notice", message: "Nested repository concern", handler: "workspace" }],
		}),
		node("nested/hidden.md", {
			kind: "modified",
			repo: "nested",
			classification: { value: "docs" },
			effectiveEmphasis: { value: "hidden" },
			signals: [
				{
					severity: "warning",
					message: "Repeated concern",
					handler: "workspace",
					location: { side: "current", line: 12 },
				},
			],
		}),
		node("other", { children: ["other/keep.ts"] }),
		node("other/keep.ts", { kind: "added", repo: "." }),
		node("transition", {
			kind: "deleted",
			repo: ".",
			base: { path: "transition", kind: "file" },
			current: { path: "transition", kind: "directory" },
			children: ["transition/child.ts"],
			signals: [{ severity: "warning", message: "Direct transition concern", handler: "workspace" }],
		}),
		node("transition/child.ts", {
			kind: "added",
			repo: ".",
			signals: [{ severity: "notice", message: "Child transition concern", handler: "workspace" }],
		}),
	];
	const nodes = Object.fromEntries(entries.map((entry) => [entry.path, entry]));
	function count(path: string): AnalysisWireNode["signalCounts"] {
		const entry = nodes[path];
		if (!entry) throw new Error(`Missing fixture node ${path}`);
		entry.signalCounts = { notice: 0, warning: 0 };
		for (const signal of entry.signals) entry.signalCounts[signal.severity]++;
		for (const child of entry.children) {
			const counts = count(child);
			entry.signalCounts.notice += counts.notice;
			entry.signalCounts.warning += counts.warning;
		}
		return entry.signalCounts;
	}
	count(".");
	return { root: ".", nodes, handlers: {}, codebases: {} };
}
function serve(facts = fixture()) {
	return suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => Response.json(identity)),
		http.get("http://localhost/api/changes/analysis", () => Response.json(facts)),
	);
}
async function observe(path?: string) {
	window.history.replaceState({}, "", path === undefined ? "/" : `/?${new URLSearchParams({ path })}`);
	const user = userEvent.setup();
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	await screen.findByRole("button", { name: "Select ." });
	return user;
}
const navigator = () => within(screen.getByRole("complementary", { name: "Changes navigator" }));
const viewer = () => within(screen.getByRole("region", { name: "Selection details" }));
const messages = () => within(screen.getByRole("region", { name: "Signal details" }));
const selectedPath = () => new URL(window.location.href).searchParams.get("path");

it("exposes the complete attributed canonical list through either severity and inspects direct folder sources", async () => {
	serve();
	const user = await observe();
	const warning = await navigator().findByRole("button", { name: "Inspect warnings for src" });
	await user.hover(warning);
	const tooltip = await screen.findByRole("tooltip");
	expect(within(tooltip).getAllByText("Repeated concern")).toHaveLength(2);
	expect(tooltip).toHaveTextContent("Folder concern");
	expect(tooltip).toHaveTextContent("src/");
	expect(tooltip).not.toHaveTextContent("Severity");
	await user.unhover(warning);
	await user.hover(navigator().getByRole("button", { name: "Inspect notices for src" }));
	expect(within(await screen.findByRole("tooltip")).getAllByText("Repeated concern")).toHaveLength(2);
	await user.click(navigator().getByRole("button", { name: "Inspect notices for src" }));
	expect(selectedPath()).toBe("src");
	expect(messages().getAllByText("Repeated concern")).toHaveLength(2);
	expect(messages().getByText("Folder concern")).toBeInTheDocument();
	expect(messages().getByText(/codebase:second/)).toBeInTheDocument();
	expect(messages().getByText(/base.*7.*3/i)).toBeInTheDocument();
	await user.click(messages().getByRole("button", { name: "Inspect source src" }));
	expect(selectedPath()).toBe("src");
	expect(messages().getByText("Folder concern")).toBeInTheDocument();
	await user.click(messages().getAllByRole("button", { name: "Inspect source src/renamed.ts" })[0] as HTMLElement);
	expect(selectedPath()).toBe("src/renamed.ts");
	expect(viewer().getByRole("heading", { name: "src/renamed.ts" })).toBeInTheDocument();
	expect(messages().getAllByText("Repeated concern")).toHaveLength(2);
});

it("discovers nested and filtered sources from zero-visible repositories and reveals only missing categories", async () => {
	serve();
	const user = await observe();
	await navigator().findByRole("button", { name: "Inspect warnings for nested" });
	await user.click(screen.getByRole("button", { name: "Docs", pressed: true }));
	await user.click(screen.getByRole("button", { name: "Collapse other" }));
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for ." }));
	expect(messages().getAllByText("Repeated concern")).toHaveLength(3);
	expect(messages().getByText("Nested repository concern")).toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for nested" }));
	expect(messages().getByText("Repeated concern")).toBeInTheDocument();
	expect(messages().getByText(/filtered/i)).toBeInTheDocument();
	await user.click(messages().getByRole("button", { name: "Inspect source nested/hidden.md" }));
	expect(selectedPath()).toBe("nested/hidden.md");
	expect(screen.getByRole("button", { name: "Docs", pressed: false })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "None", pressed: false })).toBeInTheDocument();
	expect(navigator().queryByRole("button", { name: "Select nested/hidden.md" })).not.toBeInTheDocument();
	const historyLength = window.history.length;
	await user.click(messages().getByRole("button", { name: "Reveal file nested/hidden.md" }));
	expect(window.history.length).toBe(historyLength);
	expect(screen.getByRole("button", { name: "Docs", pressed: true })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "None", pressed: true })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Code", pressed: true })).toBeInTheDocument();
	expect(navigator().getByRole("button", { name: "Select nested/hidden.md", pressed: true })).toBeInTheDocument();
	expect(navigator().getByRole("button", { name: "Expand other" })).toBeInTheDocument();
	expect(messages().getByText("Repeated concern")).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Docs", pressed: true }));
	await user.click(navigator().getByRole("button", { name: "Collapse ." }));
	await user.click(viewer().getByRole("button", { name: "Hide signal details" }));
	await user.click(viewer().getByRole("button", { name: "Show signal details" }));
	await user.click(messages().getByRole("button", { name: "Reveal file nested/hidden.md" }));
	expect(navigator().getByRole("button", { name: "Select nested/hidden.md", pressed: true })).toBeInTheDocument();
	expect(navigator().getByRole("button", { name: "Expand other" })).toBeInTheDocument();
	expect(window.history.length).toBe(historyLength);
	await user.click(navigator().getByRole("button", { name: "Select src" }));
	await user.click(navigator().getByRole("button", { name: "Collapse nested" }));
	await act(async () => window.history.back());
	await waitFor(() => expect(selectedPath()).toBe("nested/hidden.md"));
	expect(viewer().getByRole("button", { name: "Show signal details" })).toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Collapse nested" }));
	await user.click(screen.getByRole("button", { name: "Config", pressed: true }));
	expect(navigator().getByRole("button", { name: "Expand nested" })).toBeInTheDocument();
});

it("resets ordinary disclosure, repeats inspection without toggling selection and does not replay through history", async () => {
	serve();
	const user = await observe("src");
	await viewer().findByRole("button", { name: "Show signal details" });
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for src" }));
	expect(messages().getByText("Folder concern")).toBeInTheDocument();
	await user.click(viewer().getByRole("button", { name: "Hide signal details" }));
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for src" }));
	expect(selectedPath()).toBe("src");
	expect(messages().getByText("Folder concern")).toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Select transition" }));
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
	await act(async () => window.history.back());
	await waitFor(() => expect(selectedPath()).toBe("src"));
	expect(viewer().getByRole("button", { name: "Show signal details" })).toBeInTheDocument();
	await act(async () => window.history.forward());
	await waitFor(() => expect(selectedPath()).toBe("transition"));
	expect(viewer().getByRole("button", { name: "Show signal details" })).toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Select transition" }));
	expect(selectedPath()).toBeNull();
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
});

it("keeps Ctrl+Click path copying and ordinary selection separate from signal inspection", async () => {
	serve();
	const user = await observe("src/renamed.ts");
	const copy = vi.spyOn(globalThis.navigator.clipboard, "writeText").mockResolvedValue();
	await navigator().findByRole("button", { name: "Select src/renamed.ts", pressed: true });
	await user.keyboard("{Control>}");
	await user.click(navigator().getByRole("button", { name: "Select src/renamed.ts" }));
	await user.keyboard("{/Control}");
	expect(await screen.findByText("Copied: src/renamed.ts")).toBeInTheDocument();
	expect(copy).toHaveBeenCalledWith("src/renamed.ts");
	expect(selectedPath()).toBe("src/renamed.ts");
	expect(viewer().getByRole("button", { name: "Show signal details" })).toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for src/renamed.ts" }));
	expect(messages().getAllByText("Repeated concern")).toHaveLength(2);
});

it("retains interactive messages during refresh and failure, replaces them only on acknowledged recovery", async () => {
	const network = serve();
	const user = await observe("src");
	await viewer().findByRole("button", { name: "Show signal details" });
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for src" }));
	const pending = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => pending.handle(request)));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(pending.request).toBeDefined());
	expect(screen.getByRole("status")).toHaveTextContent("Updating");
	expect(messages().getAllByText("Repeated concern")).toHaveLength(2);
	await user.click(viewer().getByRole("button", { name: "Hide signal details" }));
	await user.click(navigator().getByRole("button", { name: "Inspect notices for src" }));
	await act(async () => pending.release(new Response("failed", { status: 503 })));
	expect(await screen.findByRole("alert")).toHaveTextContent("Change summary is stale");
	expect(messages().getByText("Folder concern")).toBeInTheDocument();
	const retry = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => retry.handle(request)));
	await user.click(screen.getByRole("button", { name: "Retry changes" }));
	const refreshed = fixture();
	const src = refreshed.nodes.src;
	if (!src) throw new Error("Missing src fixture");
	src.signals = [{ severity: "notice", message: "Accepted replacement", handler: "workspace" }];
	expect(messages().queryByText("Accepted replacement")).not.toBeInTheDocument();
	await act(async () => retry.release(Response.json(refreshed)));
	expect(await messages().findByText("Accepted replacement")).toBeInTheDocument();
	expect(messages().queryByText("Folder concern")).not.toBeInTheDocument();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("removes vanished messages, resets a surviving subject and clears a disappeared source after success", async () => {
	const network = serve();
	const user = await observe("nested");
	await viewer().findByRole("button", { name: "Show signal details" });
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for nested" }));
	const empty: WorkspaceAnalysis = { root: ".", nodes: { ".": node(".") }, handlers: {}, codebases: {} };
	network.use(http.get("http://localhost/api/changes/analysis", () => Response.json(empty)));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("No changed entries.");
	expect(selectedPath()).toBe("nested");
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
	expect(viewer().queryByRole("button", { name: "Show signal details" })).not.toBeInTheDocument();
	network.use(http.get("http://localhost/api/changes/analysis", () => Response.json(fixture())));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await viewer().findByRole("button", { name: "Show signal details" });
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
	await user.click(navigator().getByRole("button", { name: "Inspect warnings for src/renamed.ts" }));
	network.use(http.get("http://localhost/api/changes/analysis", () => Response.json(empty)));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	expect(await screen.findByText(/Selection is unavailable: src\/renamed.ts/)).toBeInTheDocument();
	expect(selectedPath()).toBeNull();
	expect(screen.queryByRole("region", { name: "Signal details" })).not.toBeInTheDocument();
});
