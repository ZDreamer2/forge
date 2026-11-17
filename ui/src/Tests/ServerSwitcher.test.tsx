// @vitest-environment jsdom
import type {
	AnalysisWireNode,
	ServerHubSelection,
	ServerHubServers,
	WorkspaceAnalysis,
	WorkspaceIdentity,
} from "@forge/api-contract";
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
	beforeCancel: [() => cleanup(), () => vi.restoreAllMocks()],
	prepare() {
		// jsdom has no layout; keep destinations in the strip here. Packed Chromium
		// acceptance owns width measurement, overflow and menu placement.
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			return new DOMRect(0, 0, this.getAttribute("aria-label") === "Workspaces" ? 1200 : 0, 0);
		});
	},
	runCleanup: (finish) => act(finish),
});
const identity: WorkspaceIdentity = {
	workspace: { name: "Actual checkout", root: "/fixture" },
	repositories: [{ path: ".", status: "available", gitRoot: "/fixture" }],
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
const analysis: WorkspaceAnalysis = {
	root: ".",
	handlers: {},
	codebases: {},
	guidance: { workspace: [], codebases: {} },
	nodes: {
		".": node(".", { children: ["a.ts", "b.ts"] }),
		"a.ts": node("a.ts", { kind: "modified", statistics: { added: 0, removed: 0, binary: false } }),
		"b.ts": node("b.ts", { kind: "modified", statistics: { added: 0, removed: 0, binary: false } }),
	},
};
function server(
	name: string,
	url: string,
	status: "unknown" | "reachable" | "unavailable" = "reachable",
	stale = false,
): ServerHubServers["servers"][number] {
	return {
		id: `fixture-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
		name,
		url,
		availability: {
			status,
			stale: status === "unknown" || stale,
			checkedAt: status === "unknown" ? null : "2026-11-01T00:00:00.000Z",
			lastReachableAt: status === "reachable" ? "2026-11-01T00:00:00.000Z" : null,
			error: status === "unavailable" ? "Probe failed" : null,
		},
	};
}
function snapshot(servers: ServerHubSelection["servers"], extra: Partial<ServerHubSelection> = {}): ServerHubSelection {
	return {
		source: { status: "selected", url: "http://127.0.0.1:4200/" },
		servers,
		lastSuccessAt: servers === null ? null : "2026-11-01T00:00:00.000Z",
		error: null,
		stale: false,
		...extra,
	};
}
function reviewHandlers() {
	return [
		http.get("http://localhost/api/workspace", () => Response.json(identity)),
		http.get("http://localhost/api/changes/analysis", () => Response.json(analysis)),
		fileHandler(analysis),
	];
}
function switcher() {
	return within(screen.getByRole("navigation", { name: "Workspaces" }));
}
function header() {
	return within(document.querySelector("[data-workspace-header]") as HTMLElement);
}

it("preserves literal registration order, all exact URL matches and the initial snapshot through review actions and cached remount", async () => {
	const user = userEvent.setup();
	const entries = [
		server("<img src=x onerror=alert(1)>", "http://localhost"),
		server("Different port", "http://localhost:4321/"),
		server("Duplicate current", "http://localhost/"),
		server("Different path", "http://localhost/other/"),
		server("Different host", "http://127.0.0.1/"),
	];
	let reads = 0;
	const network = suite.createHttpScenario(
		...reviewHandlers(),
		http.get("http://localhost/api/server-hub/selection", () => {
			reads++;
			return Response.json(snapshot(entries));
		}),
	);
	window.history.replaceState({}, "", "/?path=a.ts#review-fragment");
	const client = suite.createQueryClient();
	const mounted = render(<App queryClient={client} env="test" />);
	await screen.findByRole("button", { name: "Select a.ts", pressed: true });
	await switcher().findByRole("link", { name: /Duplicate current/ });
	const links = switcher().getAllByRole("link");
	expect(links.map((link) => link.textContent)).toEqual(entries.map((entry) => entry.name));
	for (const [index, link] of links.entries()) {
		expect(link).toHaveAttribute("href", entries[index]?.url);
		expect(link.getAttribute("aria-current")).toBe(index === 0 || index === 2 ? "page" : null);
	}
	expect(screen.queryByRole("heading", { name: identity.workspace.name })).not.toBeInTheDocument();
	expect(document.querySelector("img[onerror]")).toBeNull();
	// The harness retains handler errors through teardown, including requests that
	// occur later than these settled UI assertions.
	network.use(
		http.get("http://localhost/api/server-hub/selection", () => {
			throw new Error("Unexpected hub snapshot reread");
		}),
	);
	await user.click(screen.getByRole("button", { name: "Select b.ts" }));
	await act(async () => window.history.back());
	await screen.findByRole("button", { name: "Select a.ts", pressed: true });
	await act(async () => window.history.forward());
	await screen.findByRole("button", { name: "Select b.ts", pressed: true });
	await user.click(screen.getByRole("button", { name: "Code" }));
	expect(screen.queryByRole("button", { name: "Select ." })).not.toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
	network.use(http.get("http://localhost/api/changes/analysis", () => new Response("failed", { status: 503 })));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByRole("button", { name: "Retry changes" });
	network.use(http.get("http://localhost/api/changes/analysis", () => Response.json(analysis)));
	await user.click(screen.getByRole("button", { name: "Retry changes" }));
	await waitFor(() => expect(screen.queryByRole("button", { name: "Retry changes" })).not.toBeInTheDocument());
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(new Event("offline"));
		window.dispatchEvent(new Event("online"));
	});
	mounted.unmount();
	render(<App queryClient={client} env="test" />);
	await screen.findByRole("navigation", { name: "Workspaces" });
	await switcher().findByRole("link", { name: /Duplicate current/ });
	expect(reads).toBe(1);
});

it("keeps actual unmatched identity when filters hide the root and resolves deferred local inspection independently", async () => {
	const user = userEvent.setup();
	const network = suite.createHttpScenario(...reviewHandlers());
	const pending = network.deferResponse();
	network.use(http.get("http://localhost/api/server-hub/selection", ({ request }) => pending.handle(request)));
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	await screen.findByRole("heading", { name: identity.workspace.name });
	await waitFor(() => expect(pending.request).toBeDefined());
	expect(header().getByText(/loading/i)).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Code" }));
	expect(screen.queryByRole("button", { name: "Select ." })).not.toBeInTheDocument();
	expect(screen.getByRole("heading", { name: identity.workspace.name })).toBeVisible();
	await act(async () =>
		pending.release(Response.json(snapshot(null, { source: { status: "unconfigured", url: null } }))),
	);
	expect(await header().findByText("Switcher not configured")).toBeInTheDocument();
	expect(screen.getByRole("heading", { name: identity.workspace.name })).toBeVisible();
	expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

it("keeps retained destinations and each recorded stale status actionable through a hub failure", async () => {
	const user = userEvent.setup();
	const entries = [
		server("Stale unknown", "http://localhost:4301/", "unknown", true),
		server("Stale unavailable", "http://localhost:4302/", "unavailable", true),
		server("Stale reachable", "http://localhost:4303/", "reachable", true),
	];
	suite.createHttpScenario(
		...reviewHandlers(),
		http.get("http://localhost/api/server-hub/selection", () =>
			Response.json(snapshot(entries, { error: "<script>hub offline</script>", stale: true })),
		),
	);
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	await screen.findByRole("navigation", { name: "Workspaces" });
	await switcher().findByRole("link", { name: /Stale unknown/ });
	for (const entry of entries) {
		const link = switcher().getByRole("link", { name: new RegExp(entry.name) });
		expect(link).toHaveAttribute("href", entry.url);
		await user.hover(link);
		expect(await screen.findByRole("tooltip")).toHaveTextContent(/stale/i);
		expect(screen.getByRole("tooltip")).toHaveTextContent(new RegExp(entry.availability.status, "i"));
		await user.unhover(link);
	}
	await user.hover(header().getByText(/Hub list unavailable/i));
	expect(await screen.findByRole("tooltip")).toHaveTextContent("<script>hub offline</script>");
	expect(screen.getByRole("tooltip")).toHaveTextContent(/reload the page/i);
	await user.unhover(header().getByText(/Hub list unavailable/i));
	expect(screen.getByRole("heading", { name: identity.workspace.name })).toBeVisible();
	expect(screen.getByRole("button", { name: "Select a.ts" })).toBeEnabled();
	expect(document.querySelector("script")).toBeNull();
});

it("distinguishes waiting, an empty list, unavailable configuration and old-server inspection failure without blocking identity recovery", async () => {
	const user = userEvent.setup();
	const network = suite.createHttpScenario(...reviewHandlers());
	const scenarios = [
		{ response: () => Response.json(snapshot(null)), label: /waiting/i },
		{ response: () => Response.json(snapshot([])), label: /no.*destinations/i },
		{
			response: () =>
				Response.json(
					snapshot(null, { source: { status: "configuration-unavailable", url: null }, error: "Bad local YAML" }),
				),
			label: /configuration/i,
		},
		{ response: () => Response.json(snapshot(null, { error: "Hub did not answer" })), label: /unavailable/i },
		{ response: () => new Response("old server", { status: 404 }), label: /unavailable/i },
	];
	for (const scenario of scenarios) {
		network.use(http.get("http://localhost/api/server-hub/selection", scenario.response));
		const mounted = render(<App queryClient={suite.createQueryClient()} env="test" />);
		await screen.findByRole("heading", { name: identity.workspace.name });
		await header().findByText(scenario.label);
		expect(header().queryByText("Switcher not configured")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Select a.ts" })).toBeEnabled();
		expect(switcher().queryByRole("button", { name: /refresh|retry/i })).not.toBeInTheDocument();
		mounted.unmount();
	}
	network.use(http.get("http://localhost/api/workspace", () => new Response("failed", { status: 503 })));
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	await screen.findByRole("button", { name: "Retry workspace" });
	expect(screen.getByRole("heading", { name: "Workspace" })).toBeVisible();
	expect(await header().findByText(/unavailable/i)).toBeInTheDocument();
	const warning = header().getByText(/unavailable/i);
	await user.hover(warning);
	expect(await screen.findByRole("tooltip")).toHaveTextContent("404");
	expect(screen.getByRole("tooltip")).toHaveTextContent(/reload the page/i);
	await user.unhover(warning);
	network.use(
		http.get("http://localhost/api/server-hub/selection", () => {
			throw new Error("Unexpected failed inspection retry");
		}),
	);
	network.use(http.get("http://localhost/api/workspace", () => Response.json(identity)));
	await user.click(screen.getByRole("button", { name: "Retry workspace" }));
	expect(await screen.findByRole("heading", { name: identity.workspace.name })).toBeVisible();
	expect(header().getByText(/unavailable/i)).toBeInTheDocument();
});
