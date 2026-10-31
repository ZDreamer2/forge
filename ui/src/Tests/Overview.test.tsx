// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
	workspace: { root: "/tmp/<workspace>", name: "<img src=x onerror=alert(1)>" },
	repositories: [
		{ path: "<script>repository</script>", status: "available", gitRoot: "/tmp/repository" },
		{ path: "missing-checkout", status: "missing" },
	],
};
function node(path: string, extra: Partial<AnalysisWireNode> = {}): AnalysisWireNode {
	return {
		path,
		children: [],
		signals: [],
		effectiveEmphasis: { value: "normal" },
		signalCounts: { notice: 0, warning: 0 },
		rawTotals: { added: 0, removed: 0 },
		attentionTotals: { added: 0, removed: 0 },
		...extra,
	};
}
function analysis(empty = false): WorkspaceAnalysis {
	return {
		root: ".",
		codebases: {},
		handlers: {},
		nodes: empty
			? { ".": node(".") }
			: {
					".": node(".", {
						children: ["src"],
						rawTotals: { added: 20, removed: 7 },
						attentionTotals: { added: 5, removed: 2 },
					}),
					src: node("src", { children: ["src/mode", "src/new-name", "src/hidden"] }),
					"src/mode": node("src/mode", { kind: "modified", statistics: { added: 0, removed: 0, binary: false } }),
					"src/new-name": node("src/new-name", {
						kind: "renamed",
						from: "src/old-name",
						effectiveEmphasis: { value: "deemphasized" },
					}),
					"src/hidden": node("src/hidden", { kind: "added", effectiveEmphasis: { value: "hidden" } }),
				},
	};
}
function start() {
	return render(<App queryClient={suite.createQueryClient()} env="test" />);
}
function expectTotal(label: string, value: string) {
	expect(screen.getByText(label).parentElement).toHaveTextContent(`${label}${value}`);
}
const identityHandler = () => http.get("http://localhost/api/workspace", () => Response.json(identity));
const analysisHandler = (empty = false) =>
	http.get("http://localhost/api/changes/analysis", () => Response.json(analysis(empty)));

it("shows canonical entries including metadata and renames, distinct totals and literal identity", async () => {
	const requests: string[] = [];
	suite.createHttpScenario(
		http.get("http://localhost/api/workspace", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return Response.json(identity);
		}),
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return Response.json(analysis());
		}),
	);
	start();
	expect(await screen.findByText(identity.workspace.name)).toBeInTheDocument();
	await screen.findByText("Changed entries");
	expectTotal("Changed entries", "3");
	expectTotal("All-change additions", "20");
	expectTotal("All-change removals", "7");
	expectTotal("Attention additions", "5");
	expectTotal("Attention removals", "2");
	expect(screen.getByText("/tmp/<workspace>")).toBeInTheDocument();
	expect(screen.getByText("<script>repository</script>: Available")).toBeInTheDocument();
	expect(screen.getByText("missing-checkout: Missing")).toBeInTheDocument();
	expect(document.querySelector("img,script")).toBeNull();
	expect(requests.sort()).toEqual(["/api/changes/analysis", "/api/workspace"]);
});

it("retains identity while analysis loads and distinguishes a true empty result", async () => {
	const network = suite.createHttpScenario(identityHandler());
	const response = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => response.handle(request)));
	start();
	expect(await screen.findByText(identity.workspace.name)).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
	expect(screen.queryByText("Changed entries")).not.toBeInTheDocument();
	await act(async () => response.release(Response.json(analysis(true))));
	expect(await screen.findByText("No changed entries.")).toBeInTheDocument();
	expectTotal("Changed entries", "0");
	expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

it("keeps totals usable after identity failure and retries identity successfully", async () => {
	const network = suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => new Response("unavailable", { status: 503 })),
		analysisHandler(),
	);
	start();
	expect(await screen.findByRole("alert")).toHaveTextContent("Could not load workspace identity.");
	await screen.findByText("Changed entries");
	expectTotal("Changed entries", "3");
	network.use(identityHandler());
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry workspace" }));
	expect(await screen.findByText(identity.workspace.name)).toBeInTheDocument();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps malformed JSON failure local and never shows unknown changes as zero", async () => {
	const report = vi.spyOn(console, "error");
	try {
		const network = suite.createHttpScenario(
			identityHandler(),
			http.get(
				"http://localhost/api/changes/analysis",
				() => new Response("{broken", { headers: { "Content-Type": "application/json" } }),
			),
		);
		start();
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not load change summary.");
		expect(screen.queryByText("Changed entries")).not.toBeInTheDocument();
		expect(screen.queryByText("No changed entries.")).not.toBeInTheDocument();
		network.use(analysisHandler(true));
		await userEvent.setup().click(screen.getByRole("button", { name: "Retry changes" }));
		expect(await screen.findByText("No changed entries.")).toBeInTheDocument();
		expect(report).not.toHaveBeenCalled();
	} finally {
		report.mockRestore();
	}
});

it("acknowledges refresh, preserves pending totals and visibly marks failure stale until retry", async () => {
	const network = suite.createHttpScenario(identityHandler(), analysisHandler());
	start();
	await screen.findByText("Changed entries");
	const refreshed = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => refreshed.handle(request)));
	await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(refreshed.request).toBeDefined());
	expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
	expect(screen.getByRole("status")).toHaveTextContent("Updating");
	expectTotal("Changed entries", "3");
	await act(async () => refreshed.release(new Response("failed", { status: 500 })));
	expect(await screen.findByRole("alert")).toHaveTextContent("Change summary is stale.");
	expectTotal("Changed entries", "3");
	expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
	const retry = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => retry.handle(request)));
	await userEvent.setup().click(screen.getByRole("button", { name: "Retry changes" }));
	await act(async () => retry.release(Response.json(analysis(true))));
	expect(await screen.findByText("No changed entries.")).toBeInTheDocument();
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not refresh on focus, reconnect or cached remount", async () => {
	const seen = vi.fn();
	suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => {
			seen();
			return Response.json(identity);
		}),
		http.get("http://localhost/api/changes/analysis", () => {
			seen();
			return Response.json(analysis());
		}),
	);
	const queryClient = suite.createQueryClient();
	const mounted = render(<App queryClient={queryClient} env="test" />);
	await screen.findByText("Changed entries");
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(new Event("offline"));
		window.dispatchEvent(new Event("online"));
	});
	mounted.unmount();
	render(<App queryClient={queryClient} env="test" />);
	await screen.findByText("Changed entries");
	expect(seen).toHaveBeenCalledTimes(2);
});

it("refreshes and retries the loopback API while the browser reports offline", async () => {
	const requests: string[] = [];
	const network = suite.createHttpScenario(
		http.get("http://localhost/api/workspace", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return Response.json(identity);
		}),
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return Response.json(analysis());
		}),
	);
	start();
	await screen.findByText("Changed entries");
	await screen.findByText(identity.workspace.name);
	try {
		await act(async () => {
			window.dispatchEvent(new Event("offline"));
		});
		const refreshed = network.deferResponse();
		network.use(
			http.get("http://localhost/api/changes/analysis", ({ request }) => {
				requests.push(new URL(request.url).pathname);
				return refreshed.handle(request);
			}),
		);
		await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() => expect(refreshed.request).toBeDefined());
		expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent("Updating");
		await act(async () => refreshed.release(new Response("failed", { status: 500 })));
		expect(await screen.findByRole("alert")).toHaveTextContent("Change summary is stale.");
		network.use(
			http.get("http://localhost/api/changes/analysis", ({ request }) => {
				requests.push(new URL(request.url).pathname);
				return Response.json(analysis(true));
			}),
		);
		await userEvent.setup().click(screen.getByRole("button", { name: "Retry changes" }));
		expect(await screen.findByText("No changed entries.")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		await act(async () => {
			window.dispatchEvent(new Event("online"));
		});
		expect(requests).toHaveLength(5);
	} finally {
		await act(async () => {
			window.dispatchEvent(new Event("online"));
		});
	}
});

it("cancels pending reads when the last rendered consumer unmounts", async () => {
	const network = suite.createHttpScenario();
	const workspace = network.deferResponse();
	const changes = network.deferResponse();
	network.use(
		http.get("http://localhost/api/workspace", ({ request }) => workspace.handle(request)),
		http.get("http://localhost/api/changes/analysis", ({ request }) => changes.handle(request)),
	);
	const mounted = start();
	await waitFor(() => {
		expect(workspace.request).toBeDefined();
		expect(changes.request).toBeDefined();
	});
	mounted.unmount();
	await waitFor(() => {
		expect(workspace.state).toBe("cancelled");
		expect(changes.state).toBe("cancelled");
	});
});
