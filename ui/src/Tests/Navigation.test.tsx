// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
	workspace: { name: "Navigation workspace", root: "/fixture" },
	repositories: [
		{ path: ".", status: "available", gitRoot: "/fixture" },
		{ path: "repos/empty", status: "available", gitRoot: "/fixture/repos/empty" },
		{ path: "missing", status: "missing" },
	],
};
const special = 'src/space Ю # % ? \\ "quoted".ts';
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
function fixture(paths = ["src/a.ts", "src/b.ts", special, "123", "true", '"quoted"', "__proto__"]): WorkspaceAnalysis {
	const nodes: Record<string, AnalysisWireNode> = Object.create(null);
	nodes["."] = node(".");
	for (const path of paths) {
		const parts = path.split("/");
		let parent = ".";
		for (let i = 1; i <= parts.length; i++) {
			const key = parts.slice(0, i).join("/");
			if (!Object.hasOwn(nodes, key)) {
				nodes[key] = node(key);
				nodes[parent]?.children.push(key);
			}
			parent = key;
		}
		nodes[path] = node(path, { kind: "modified", repo: ".", statistics: { added: 1, removed: 0, binary: false } });
	}
	nodes["."].rawTotals = { added: paths.length, removed: 0 };
	return { root: ".", nodes, handlers: {}, codebases: {} };
}
function observe(path?: string) {
	window.history.replaceState({}, "", path === undefined ? "/" : `/?${new URLSearchParams({ path })}`);
	const user = userEvent.setup();
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	return user;
}
function serve(analysis = fixture()) {
	return suite.createHttpScenario(
		fileHandler(analysis),
		http.get("http://localhost/api/workspace", () => Response.json(identity)),
		http.get("http://localhost/api/changes/analysis", () => Response.json(analysis)),
	);
}
function selectedPath() {
	return new URL(window.location.href).searchParams.get("path");
}
function details() {
	return within(screen.getByRole("region", { name: "Selection details" }));
}

it.each([".", "src", "src/a.ts", "repos/empty", "missing", special, "123", "true", '"quoted"', "__proto__"])(
	"loads literal direct selection %s",
	async (path) => {
		serve();
		observe(path);
		expect(await screen.findByRole("button", { name: `Select ${path}`, pressed: true })).toBeInTheDocument();
		expect(selectedPath()).toBe(path);
		expect(details().getByRole("heading", { name: path })).toBeInTheDocument();
	},
);

it("separates disclosure, toggling, Ctrl+Click clipboard acknowledgement and history", async () => {
	serve();
	const user = observe();
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	await screen.findByRole("button", { name: "Select src/a.ts" });
	await user.click(screen.getByRole("button", { name: "Select src/a.ts" }));
	expect(selectedPath()).toBe("src/a.ts");
	await user.click(screen.getByRole("button", { name: "Collapse src" }));
	expect(selectedPath()).toBe("src/a.ts");
	await user.click(screen.getByRole("button", { name: "Expand src" }));
	await user.keyboard("{Control>}");
	await user.click(screen.getByRole("button", { name: "Select src/a.ts" }));
	await user.keyboard("{/Control}");
	expect(await screen.findByText("Copied: src/a.ts")).toBeInTheDocument();
	expect(copy).toHaveBeenCalledWith("src/a.ts");
	expect(selectedPath()).toBe("src/a.ts");
	copy.mockRejectedValueOnce(new Error("denied"));
	await user.keyboard("{Control>}");
	await user.click(screen.getByRole("button", { name: "Select ." }));
	await user.keyboard("{/Control}");
	expect(await screen.findByText(/Could not copy path/)).toBeInTheDocument();
	expect(copy).toHaveBeenLastCalledWith(".");
	await user.click(screen.getByRole("button", { name: "Select src/b.ts" }));
	await act(async () => window.history.back());
	await waitFor(() => expect(selectedPath()).toBe("."));
	expect(await screen.findByRole("button", { name: "Select .", pressed: true })).toBeInTheDocument();
	await act(async () => window.history.forward());
	await screen.findByRole("button", { name: "Select src/b.ts", pressed: true });
	await user.click(screen.getByRole("button", { name: "Select src/b.ts" }));
	expect(selectedPath()).toBeNull();
});

it.each([
	"?path=",
	"?path=/absolute",
	"?path=src//a",
	"?path=../a",
	"?path=src/./a",
	"?path=a&path=b",
	"?path=%E0%A4%A",
	"?path=C%3A%5Cabsolute",
])("repairs invalid address %s with explanatory local feedback", async (search) => {
	serve();
	window.history.replaceState({}, "", `/${search}`);
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	expect(await screen.findByText(/Invalid selection address/)).toBeInTheDocument();
	await waitFor(() => expect(selectedPath()).toBeNull());
});

it("keeps current interactions through pending refresh, failure, and successful branch reconciliation", async () => {
	const network = serve();
	const user = observe("src/a.ts");
	await screen.findByRole("button", { name: "Select src/a.ts", pressed: true });
	await user.click(screen.getByRole("button", { name: "Collapse src" }));
	const pending = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => pending.handle(request)));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await user.click(screen.getByRole("button", { name: "Select repos/empty" }));
	await user.click(screen.getByRole("button", { name: "Code" }));
	await act(async () => pending.release(new Response("failed", { status: 503 })));
	expect(await screen.findByRole("alert")).toHaveTextContent("Change summary is stale");
	expect(selectedPath()).toBe("repos/empty");
	expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "false");
	expect(screen.queryByRole("button", { name: "Select src" })).not.toBeInTheDocument();
	const retry = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => retry.handle(request)));
	await user.click(screen.getByRole("button", { name: "Retry changes" }));
	await user.click(screen.getByRole("button", { name: "Code" }));
	await act(async () => retry.release(Response.json(fixture(["src/b.ts", "new/child.ts"]))));
	expect(await screen.findByRole("button", { name: "Select new/child.ts" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Expand src" })).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select src/a.ts" })).not.toBeInTheDocument();
	expect(selectedPath()).toBe("repos/empty");
});

it("keeps filtered selection metadata and repairs disappearing paths only after successful required reads", async () => {
	const network = serve();
	const user = observe("src/a.ts");
	await screen.findByRole("button", { name: "Select src/a.ts", pressed: true });
	await user.click(screen.getByRole("button", { name: "Code" }));
	expect(details().getByText(/outside the current filters/i)).toBeInTheDocument();
	expect(details().getByRole("heading", { name: "src/a.ts" })).toBeInTheDocument();
	network.use(
		http.get("http://localhost/api/workspace", () => new Response("failed", { status: 503 })),
		http.get("http://localhost/api/changes/analysis", () => Response.json(fixture([]))),
	);
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByRole("alert");
	expect(selectedPath()).toBe("src/a.ts");
	network.use(http.get("http://localhost/api/workspace", () => Response.json(identity)));
	await user.click(screen.getByRole("button", { name: "Retry workspace" }));
	expect(await screen.findByText(/Selection is unavailable: src\/a.ts/)).toBeInTheDocument();
	await waitFor(() => expect(selectedPath()).toBeNull());
});

it("upgrades and downgrades a declared repository selection without changing its URL", async () => {
	const network = serve(fixture([]));
	const user = observe("repos/empty");
	await screen.findByRole("button", { name: "Select repos/empty", pressed: true });
	network.use(
		http.get("http://localhost/api/changes/analysis", () => Response.json(fixture(["repos/empty/child.ts"]))),
	);
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByRole("button", { name: "Select repos/empty/child.ts" });
	expect(selectedPath()).toBe("repos/empty");
	network.use(http.get("http://localhost/api/changes/analysis", () => Response.json(fixture([]))));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("No changed entries.");
	expect(screen.getByRole("button", { name: "Select repos/empty", pressed: true })).toBeInTheDocument();
	expect(selectedPath()).toBe("repos/empty");
});

it("preserves collapsed ancestors when Refresh reparents a selected repository placeholder", async () => {
	const network = serve(fixture([]));
	const user = observe("repos/empty");
	await screen.findByRole("button", { name: "Select repos/empty", pressed: true });
	await user.click(screen.getByRole("button", { name: "Collapse ." }));
	network.use(http.get("http://localhost/api/changes/analysis", () => Response.json(fixture(["repos/new.ts"]))));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByRole("button", { name: "All workspace changes: 1 changed files, 0 removed lines, 1 added lines" });
	expect(screen.getByRole("button", { name: "Expand ." })).toBeInTheDocument();
	expect(details().getByRole("heading", { name: "repos/empty" })).toBeInTheDocument();
	expect(selectedPath()).toBe("repos/empty");
	await user.click(screen.getByRole("button", { name: "Expand ." }));
	expect(screen.getByRole("button", { name: "Select repos/new.ts" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select repos/empty", pressed: true })).toBeInTheDocument();
});
