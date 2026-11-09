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
		classification: { value: "code" },
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
function workspaceSummary(files: number, removed = 0, added = 0) {
	return screen.findByRole("button", {
		name: `All workspace changes: ${files} changed files, ${removed} removed lines, ${added} added lines`,
	});
}
const identityHandler = () => http.get("http://localhost/api/workspace", () => Response.json(identity));
const analysisHandler = (empty = false) =>
	http.get("http://localhost/api/changes/analysis", () => Response.json(analysis(empty)));

it("distinguishes unknown from empty changes, then refreshes literal identity and canonical entries", async () => {
	const user = userEvent.setup();
	const network = suite.createHttpScenario(identityHandler());
	const pending = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/analysis", ({ request }) => pending.handle(request)));
	start();
	await screen.findByRole("heading", { name: identity.workspace.name });
	expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
	const repositories = within(screen.getByRole("navigation", { name: "Registered repositories" }));
	expect(repositories.getByRole("button", { name: "Select <script>repository</script>" })).toBeInTheDocument();
	expect(repositories.getByText("Available · changes unknown")).toBeInTheDocument();
	expect(repositories.getByText("Missing at startup")).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: /All workspace changes:/ })).not.toBeInTheDocument();
	expect(document.querySelector("script, img[onerror]")).toBeNull();

	await act(async () => pending.release(Response.json(analysis(true))));
	await workspaceSummary(0);
	expect(within(screen.getByRole("navigation", { name: "Changed files" })).getByText("No changes")).toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select <script>repository</script>" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select missing-checkout" })).not.toBeInTheDocument();
	expect(screen.queryByRole("button", { name: "Select ." })).not.toBeInTheDocument();
	await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());

	network.use(analysisHandler());
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await workspaceSummary(3, 7, 20);
	const navigator = within(screen.getByRole("complementary", { name: "Changes navigator" }));
	expect(navigator.getByRole("button", { name: "Select src/mode" })).toBeInTheDocument();
	expect(navigator.getByRole("button", { name: "Select src/new-name" })).toBeInTheDocument();
	expect(navigator.queryByRole("button", { name: "Select src/hidden" })).not.toBeInTheDocument();
	expect(screen.getByTitle(identity.workspace.root)).toHaveTextContent(identity.workspace.name);
	expect(document.querySelector("script, img[onerror]")).toBeNull();
});

it("recovers malformed analysis and failed identity independently without inventing zero changes", async () => {
	const user = userEvent.setup();
	const report = vi.spyOn(console, "error");
	try {
		const network = suite.createHttpScenario(
			http.get("http://localhost/api/workspace", () => new Response("unavailable", { status: 503 })),
			http.get(
				"http://localhost/api/changes/analysis",
				() => new Response("{broken", { headers: { "Content-Type": "application/json" } }),
			),
		);
		start();
		await screen.findByRole("button", { name: "Retry workspace" });
		await screen.findByRole("button", { name: "Retry changes" });
		expect(screen.getByText(/Could not load workspace identity/)).toBeVisible();
		expect(screen.getByText(/Could not load change summary/)).toBeVisible();
		expect(screen.queryByRole("button", { name: /All workspace changes:/ })).not.toBeInTheDocument();
		expect(screen.queryByText("No changed entries.")).not.toBeInTheDocument();

		// Analysis can recover while workspace identity is still unavailable.
		network.use(analysisHandler());
		await user.click(screen.getByRole("button", { name: "Retry changes" }));
		await workspaceSummary(3, 7, 20);
		expect(screen.getByRole("alert")).toHaveTextContent("Could not load workspace identity.");
		expect(screen.queryByRole("button", { name: "Retry changes" })).not.toBeInTheDocument();

		network.use(identityHandler());
		await user.click(screen.getByRole("button", { name: "Retry workspace" }));
		await screen.findByRole("heading", { name: identity.workspace.name });
		await workspaceSummary(3, 7, 20);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(report).not.toHaveBeenCalled();
	} finally {
		report.mockRestore();
	}
});

it("retains observations through online and offline Refresh failures and accepts analysis-only recoveries", async () => {
	const user = userEvent.setup();
	const requests: string[] = [];
	const network = suite.createHttpScenario(
		http.get("http://localhost/api/workspace", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return Response.json(identity);
		}),
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return Response.json(analysis(true));
		}),
	);
	start();
	await workspaceSummary(0);
	await screen.findByRole("heading", { name: identity.workspace.name });
	await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());

	const fresh = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return fresh.handle(request);
		}),
	);
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(fresh.request).toBeDefined());
	expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
	await workspaceSummary(0);
	expect(screen.queryByRole("button", { name: "Select src/mode" })).not.toBeInTheDocument();
	await act(async () => fresh.release(new Response("failed", { status: 500 })));
	expect(await screen.findByRole("alert")).toHaveTextContent("Change summary is stale.");
	await workspaceSummary(0);
	const recovered = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			requests.push(new URL(request.url).pathname);
			return recovered.handle(request);
		}),
	);
	await user.click(screen.getByRole("button", { name: "Retry changes" }));
	await waitFor(() => expect(recovered.request).toBeDefined());
	await workspaceSummary(0);
	await act(async () => recovered.release(Response.json(analysis())));
	await workspaceSummary(3, 7, 20);
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select src/mode" })).toBeInTheDocument();
	await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());

	try {
		await act(async () => window.dispatchEvent(new Event("offline")));
		const failed = network.deferResponse();
		network.use(
			http.get("http://localhost/api/changes/analysis", ({ request }) => {
				requests.push(new URL(request.url).pathname);
				return failed.handle(request);
			}),
		);
		await user.click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() => expect(failed.request).toBeDefined());
		expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent("Updating");
		await workspaceSummary(3, 7, 20);
		await act(async () => failed.release(new Response("failed", { status: 500 })));
		expect(await screen.findByRole("alert")).toHaveTextContent("Change summary is stale.");
		await workspaceSummary(3, 7, 20);
		expect(screen.getByRole("button", { name: "Select src/mode" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();

		const retry = network.deferResponse();
		network.use(
			http.get("http://localhost/api/changes/analysis", ({ request }) => {
				requests.push(new URL(request.url).pathname);
				return retry.handle(request);
			}),
		);
		await user.click(screen.getByRole("button", { name: "Retry changes" }));
		await waitFor(() => expect(retry.request).toBeDefined());
		await workspaceSummary(3, 7, 20);
		await act(async () => retry.release(Response.json(analysis(true))));
		await workspaceSummary(0);
		expect(screen.queryByRole("button", { name: "Select src/mode" })).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(requests.filter((path) => path === "/api/workspace")).toHaveLength(3);
		expect(requests.filter((path) => path === "/api/changes/analysis")).toHaveLength(5);
	} finally {
		await act(async () => window.dispatchEvent(new Event("online")));
	}
});

it("does not refresh on focus, reconnect or cached remount", async () => {
	const seen = vi.fn();
	const network = suite.createHttpScenario(
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
	await workspaceSummary(3, 7, 20);
	await screen.findByRole("heading", { name: identity.workspace.name });
	// The HTTP owner reports late handler failures at teardown, so an automatic
	// request cannot escape detection merely by arriving after the count assertion.
	network.use(
		http.get("http://localhost/api/workspace", () => {
			throw new Error("Unexpected automatic workspace identity read");
		}),
		http.get("http://localhost/api/changes/analysis", () => {
			throw new Error("Unexpected automatic change analysis read");
		}),
	);
	await act(async () => {
		window.dispatchEvent(new Event("focus"));
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(new Event("offline"));
		window.dispatchEvent(new Event("online"));
	});
	mounted.unmount();
	render(<App queryClient={queryClient} env="test" />);
	await workspaceSummary(3, 7, 20);
	expect(seen).toHaveBeenCalledTimes(2);
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
