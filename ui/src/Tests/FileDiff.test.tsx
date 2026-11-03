// @vitest-environment jsdom
import type { AnalysisWireNode, WorkspaceAnalysis, WorkspaceFileDiff, WorkspaceIdentity } from "@forge/api-contract";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it, vi } from "vitest";
import App from "../App";
import { fileObservation } from "../Lib/Testing/Testing";

vi.mock(
	"../Components/WorkspaceReview/Components/SelectionViewer/Components/FileDiff/Internal/pierreRenderer",
	async () => (await import("../Lib/Testing/Testing")).rendererBoundary(),
);

const suite = createTestSuiteLifecycle({
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [() => cleanup()],
	runCleanup: (finish) => act(finish),
});
const special = 'space Ю\t#%?".ts';
const identity: WorkspaceIdentity = {
	workspace: { name: "Diff workspace", root: "/fixture" },
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
function fixture(): WorkspaceAnalysis {
	const entries = [
		node(".", { children: ["a.ts", "b.ts", special, "transition"], signalCounts: { notice: 0, warning: 1 } }),
		...["a.ts", "b.ts", special, "transition", "transition/child.md"].map((path) =>
			node(path, {
				kind: "modified",
				repo: ".",
				statistics: { added: 1, removed: 1, binary: false },
				base: { path, kind: "file", repository: "." },
				current: { path, kind: "file", repository: "." },
			}),
		),
	];
	const nodes = Object.fromEntries(entries.map((entry) => [entry.path, entry]));
	nodes["a.ts"] = node("a.ts", {
		...nodes["a.ts"],
		signals: [{ severity: "warning", message: "Review this source", handler: "workspace" }],
		signalCounts: { notice: 0, warning: 1 },
	});
	nodes.transition = node("transition", {
		...nodes.transition,
		children: ["transition/child.md"],
		current: { path: "transition", kind: "directory", repository: "." },
	});
	nodes["transition/child.md"] = node("transition/child.md", {
		...nodes["transition/child.md"],
		classification: { value: "docs" },
	});
	return { root: ".", nodes, codebases: {}, handlers: {} };
}
function observation(path: string, context: 3 | "all" = 3, facts = fixture()): WorkspaceFileDiff {
	const entry = facts.nodes[path];
	if (!entry?.kind) throw new Error(`Unexpected selected file ${path}`);
	const result = fileObservation(entry, facts, context);
	if (result.kind !== "text") return result;
	const from = context === "all" ? 1 : 5;
	const to = context === "all" ? 20 : 11;
	const body = Array.from({ length: to - from + 1 }, (_, index) => {
		const line = from + index;
		return line === 8 ? `-old ${path}\n+new ${path}\n` : ` context ${line}\n`;
	}).join("");
	return {
		...result,
		patch: `diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -${from},${to - from + 1} +${from},${to - from + 1} @@\n${body}`,
	};
}
function serve() {
	const reads = { workspace: 0, analysis: 0, files: [] as string[] };
	const network = suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => {
			reads.workspace++;
			return Response.json(identity);
		}),
		http.get("http://localhost/api/changes/analysis", () => {
			reads.analysis++;
			return Response.json(fixture());
		}),
		http.get("http://localhost/api/changes/file", ({ request }) => {
			reads.files.push(request.url);
			const query = new URL(request.url).searchParams;
			return Response.json(observation(query.get("path") ?? "", query.get("context") === "all" ? "all" : 3));
		}),
	);
	return { network, reads };
}
function start(path = "a.ts") {
	window.history.replaceState({}, "", `/?${new URLSearchParams({ path })}`);
	render(<App queryClient={suite.createQueryClient()} env="test" />);
	return userEvent.setup();
}
const file = () => within(screen.getByRole("region", { name: "File diff" }));
const text = () => screen.getByLabelText("Rendered diff text");
async function loaded(path = "a.ts") {
	await waitFor(() => expect(text().textContent).toContain(`new ${path}`));
}

it("loads an encoded direct selection and preserves mode through filters, navigation and history", async () => {
	const { reads } = serve();
	const user = start(special);
	await loaded(special);
	expect(new URL(reads.files[0] ?? "http://invalid").searchParams.get("path")).toBe(special);
	expect(screen.getByRole("button", { name: "Unified", pressed: true })).toBeInTheDocument();
	await user.click(screen.getByRole("button", { name: "Split" }));
	await user.click(screen.getByRole("button", { name: "Code", pressed: true }));
	expect(screen.getByText(/outside the current filters/)).toBeInTheDocument();
	expect(text().textContent).toContain(`new ${special}`);
	expect(reads.files).toHaveLength(1);
	await user.click(screen.getByRole("button", { name: "Code", pressed: false }));
	await user.click(screen.getByRole("button", { name: "Select b.ts" }));
	await loaded("b.ts");
	expect(screen.getByRole("button", { name: "Split", pressed: true })).toBeInTheDocument();
	await act(async () => window.history.back());
	await loaded(special);
	await act(async () => window.history.forward());
	await loaded("b.ts");
	expect(screen.getByRole("button", { name: "Split", pressed: true })).toBeInTheDocument();
});

it("contains file failures and retries only that file, retaining usable content after failed Refresh", async () => {
	const { network, reads } = serve();
	network.use(http.get("http://localhost/api/changes/file", () => new Response("failed", { status: 503 })));
	const user = start();
	await screen.findByRole("region", { name: "File diff" });
	expect(await file().findByRole("alert")).toHaveTextContent("Could not load file");
	expect(screen.getByRole("region", { name: "Selected entry metadata" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select b.ts" })).toBeInTheDocument();
	network.use(http.get("http://localhost/api/changes/file", () => Response.json(observation("a.ts"))));
	await user.click(file().getByRole("button", { name: "Retry file" }));
	await loaded();
	expect(reads.workspace).toBe(1);
	expect(reads.analysis).toBe(1);
	network.use(http.get("http://localhost/api/changes/file", () => new Response("failed", { status: 503 })));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	expect(await file().findByRole("alert")).toHaveTextContent("File diff is stale");
	expect(text()).toHaveTextContent("new a.ts");
	expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
	network.use(http.get("http://localhost/api/changes/file", () => Response.json(observation("a.ts"))));
	await user.click(file().getByRole("button", { name: "Retry file" }));
	await waitFor(() => expect(file().queryByRole("alert")).not.toBeInTheDocument());
});

it("retains short content through context failure and incompatible observations, then reloads before expansion", async () => {
	const { network } = serve();
	const user = start();
	await loaded();
	const pending = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			return new URL(request.url).searchParams.get("context") === "all"
				? pending.handle(request)
				: Response.json(observation("a.ts"));
		}),
	);
	await user.click(file().getByRole("button", { name: "Load omitted context" }));
	await waitFor(() => expect(pending.request).toBeDefined());
	expect(text()).toHaveTextContent("new a.ts");
	expect(text()).not.toHaveTextContent("context 1\n");
	await act(async () => pending.release(new Response("failed", { status: 503 })));
	expect(await file().findByRole("alert")).toHaveTextContent("short diff remains available");
	const all = observation("a.ts", "all");
	if (all.kind !== "text") throw new Error("Expected text fixture");
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) =>
			Response.json(
				new URL(request.url).searchParams.get("context") === "all"
					? { ...all, patch: all.patch.replace("+new a.ts", "+newer a.ts") }
					: observation("a.ts"),
			),
		),
	);
	await user.click(file().getByRole("button", { name: "Retry context" }));
	expect(await file().findByRole("alert")).toHaveTextContent("older observation");
	expect(text()).toHaveTextContent("new a.ts");
	expect(text()).not.toHaveTextContent("newer a.ts");
	let blockedReads = 0;
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			if (new URL(request.url).searchParams.get("context") === "all") blockedReads++;
			return new Response("short reload unavailable", { status: 503 });
		}),
	);
	await user.click(file().getByRole("button", { name: "Reload file" }));
	await waitFor(() =>
		expect(
			file()
				.getAllByRole("alert")
				.some((element) => element.textContent?.includes("File diff is stale")),
		).toBe(true),
	);
	expect(file().getByText(/This is an older observation/)).toBeInTheDocument();
	expect(text()).toHaveTextContent("new a.ts");
	expect(file().queryByRole("button", { name: "Load omitted context" })).not.toBeInTheDocument();
	expect(blockedReads).toBe(0);
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) =>
			Response.json(observation("a.ts", new URL(request.url).searchParams.get("context") === "all" ? "all" : 3)),
		),
	);
	await user.click(file().getByRole("button", { name: "Retry file" }));
	await waitFor(() => expect(file().queryByRole("alert")).not.toBeInTheDocument());
	await user.click(file().getByRole("button", { name: "Load omitted context" }));
	await waitFor(() => expect(text().textContent).toContain("context 1\n"));
	expect(file().queryByRole("button", { name: "Load omitted context" })).not.toBeInTheDocument();
});

it("cancels obsolete selection work and removes a disappeared subject only after accepted analysis", async () => {
	const { network } = serve();
	const pending = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) =>
			new URL(request.url).searchParams.get("path") === "a.ts"
				? pending.handle(request)
				: Response.json(observation("b.ts")),
		),
	);
	const user = start();
	await waitFor(() => expect(pending.request).toBeDefined());
	await user.click(screen.getByRole("button", { name: "Select b.ts" }));
	await loaded("b.ts");
	expect(pending.state).toBe("cancelled");
	network.use(
		http.get("http://localhost/api/changes/analysis", () =>
			Response.json({ root: ".", nodes: { ".": node(".") }, codebases: {}, handlers: {} }),
		),
	);
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	expect(await screen.findByText(/Selection is unavailable: b.ts/)).toBeInTheDocument();
	expect(new URL(window.location.href).searchParams.get("path")).toBeNull();
	expect(screen.queryByRole("region", { name: "File diff" })).not.toBeInTheDocument();
});

it("retires complete context during Refresh and waits for the selected file before acknowledging completion", async () => {
	const { network } = serve();
	const user = start();
	await loaded();
	await user.click(file().getByRole("button", { name: "Load omitted context" }));
	await waitFor(() => expect(text().textContent).toContain("context 1\n"));
	const pending = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/file", ({ request }) => pending.handle(request)));
	await user.click(screen.getByRole("button", { name: "Refresh" }));
	await waitFor(() => expect(pending.request).toBeDefined());
	expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
	expect(screen.getByRole("button", { name: "Select b.ts" })).toBeEnabled();
	expect(text()).toHaveTextContent("new a.ts");
	await act(async () => pending.release(new Response("failed", { status: 503 })));
	expect(await file().findByRole("alert")).toHaveTextContent("File diff is stale");
	expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
	expect(text().textContent).not.toContain("context 1\n");
	expect(file().getByRole("button", { name: "Load omitted context" })).toBeDisabled();
	let completeReads = 0;
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			const context = new URL(request.url).searchParams.get("context") === "all" ? "all" : 3;
			if (context === "all") completeReads++;
			return Response.json(observation("a.ts", context));
		}),
	);
	await user.click(file().getByRole("button", { name: "Retry file" }));
	await waitFor(() => expect(file().queryByRole("alert")).not.toBeInTheDocument());
	expect(text().textContent).not.toContain("context 1\n");
	await user.click(file().getByRole("button", { name: "Load omitted context" }));
	await waitFor(() => expect(text().textContent).toContain("context 1\n"));
	expect(completeReads).toBe(1);
});

it.each([
	["not_changed", "This entry is no longer changed"],
	["metadata_only", "Metadata-only change"],
	["binary", "Binary file"],
	["encoding", "unsupported text encoding"],
	["too_large", "exceeds the text size limit"],
])("explains %s without presenting an empty text diff", async (kind, message) => {
	const { network } = serve();
	const ordinary = observation("a.ts");
	const result =
		kind === "not_changed"
			? { kind, codebases: {} }
			: kind === "metadata_only"
				? { ...ordinary, kind }
				: { ...ordinary, kind: "unsupported", reason: kind, limitBytes: 4194304 };
	network.use(http.get("http://localhost/api/changes/file", () => Response.json(result)));
	start();
	expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
	expect(screen.queryByLabelText("Rendered diff text")).not.toBeInTheDocument();
	expect(screen.getByRole("region", { name: "Selected entry metadata" })).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Select b.ts" })).toBeInTheDocument();
});

it("contains a real strict-parser error, reports once and preserves signals, metadata and navigation during recovery", async () => {
	const { network } = serve();
	const valid = observation("a.ts");
	if (valid.kind !== "text") throw new Error("Expected text fixture");
	network.use(
		http.get("http://localhost/api/changes/file", () =>
			Response.json({ ...valid, patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n" }),
		),
	);
	const report = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const user = start();
		await screen.findByRole("region", { name: "File diff" });
		expect(await file().findByRole("alert")).toHaveTextContent("could not be rendered");
		expect(report).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith("Unexpected Forge failure", expect.any(Error));
		expect(screen.getByRole("region", { name: "Selected entry metadata" })).toHaveTextContent("Modified entry");
		await user.click(screen.getByRole("button", { name: "Show signal details" }));
		expect(screen.getByRole("region", { name: "Signal details" })).toHaveTextContent("Review this source");
		await user.click(screen.getByRole("button", { name: "Split" }));
		expect(report).toHaveBeenCalledTimes(1);
		network.use(
			http.get("http://localhost/api/changes/file", ({ request }) =>
				Response.json(observation(new URL(request.url).searchParams.get("path") ?? "")),
			),
		);
		await user.click(file().getByRole("button", { name: "Reload file" }));
		await loaded();
		expect(file().queryByRole("alert")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Select b.ts" }));
		await loaded("b.ts");
		expect(report).toHaveBeenCalledTimes(1);
	} finally {
		report.mockRestore();
	}
});

it("loads a transition's own diff alongside its subtree and supports signal-source reveal without replacing the file", async () => {
	const { reads } = serve();
	const user = start("transition");
	await loaded("transition");
	expect(screen.getByText(/2 visible changed files/)).toBeInTheDocument();
	expect(screen.getByRole("region", { name: "Selected entry metadata" })).toHaveTextContent("directory");
	await user.click(screen.getByRole("button", { name: "Inspect warnings for ." }));
	await user.click(screen.getByRole("button", { name: "Inspect source a.ts" }));
	await loaded();
	await user.click(screen.getByRole("button", { name: "Code", pressed: true }));
	const count = reads.files.length;
	await user.click(screen.getByRole("button", { name: "Reveal file a.ts" }));
	expect(screen.getByRole("button", { name: "Select a.ts", pressed: true })).toBeInTheDocument();
	expect(text()).toHaveTextContent("new a.ts");
	expect(reads.files).toHaveLength(count);
});

it.each([false, true])("compares available statistics including binary status (missing: %s)", async (missing) => {
	const { network } = serve();
	const facts = fixture();
	const entry = facts.nodes["a.ts"];
	if (!entry) throw new Error("Missing fixture entry");
	if (missing) delete entry.statistics;
	else entry.statistics = { added: 0, removed: 0, binary: true };
	const response = fileObservation(entry, facts);
	if (response.kind === "not_changed") throw new Error("Expected changed observation");
	network.use(
		http.get("http://localhost/api/changes/analysis", () => Response.json(facts)),
		http.get("http://localhost/api/changes/file", () =>
			Response.json({ ...response, kind: "metadata_only", statistics: { added: 0, removed: 0, binary: false } }),
		),
	);
	start();
	await screen.findByRole("region", { name: "File diff" });
	expect(await file().findByText(/Metadata-only change/)).toBeInTheDocument();
	if (missing) expect(file().queryByText(/analysis summary describes an older/)).not.toBeInTheDocument();
	else expect(file().getByText(/analysis summary describes an older/)).toBeInTheDocument();
});

it("keeps one context recovery action as refusal and request failure replace each other", async () => {
	const { network } = serve();
	const user = start();
	await loaded();
	const all = observation("a.ts", "all");
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			if (new URL(request.url).searchParams.get("context") !== "all") throw new Error("Expected complete read");
			return Response.json({ ...all, kind: "unsupported", reason: "too_large", limitBytes: 4194304 });
		}),
	);
	await user.click(file().getByRole("button", { name: "Load omitted context" }));
	expect(await file().findByRole("alert")).toHaveTextContent("Complete context exceeds the text size limit");
	expect(file().getAllByRole("button", { name: "Retry context" })).toHaveLength(1);
	expect(text()).toHaveTextContent("new a.ts");
	network.use(http.get("http://localhost/api/changes/file", () => new Response("unavailable", { status: 503 })));
	await user.click(file().getByRole("button", { name: "Retry context" }));
	await waitFor(() => expect(file().getByRole("alert")).toHaveTextContent("Could not load omitted context"));
	expect(file().getAllByRole("button", { name: "Retry context" })).toHaveLength(1);
	expect(text()).toHaveTextContent("new a.ts");
	expect(text().textContent).not.toContain("context 1\n");
	network.use(http.get("http://localhost/api/changes/file", () => Response.json(all)));
	await user.click(file().getByRole("button", { name: "Retry context" }));
	await waitFor(() => expect(text().textContent).toContain("context 1\n"));
	expect(file().queryByRole("alert")).not.toBeInTheDocument();
	expect(file().queryByRole("button", { name: "Retry context" })).not.toBeInTheDocument();
});

it("keeps a complete-patch parser failure in context recovery and reports once across presentation changes", async () => {
	const { network } = serve();
	const report = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const user = start();
		await loaded();
		const all = observation("a.ts", "all");
		if (all.kind !== "text") throw new Error("Expected text fixture");
		network.use(
			http.get("http://localhost/api/changes/file", ({ request }) => {
				if (new URL(request.url).searchParams.get("context") !== "all") throw new Error("Expected complete read");
				return Response.json({
					...all,
					patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n",
				});
			}),
		);
		await user.click(file().getByRole("button", { name: "Load omitted context" }));
		expect(await file().findByRole("alert")).toHaveTextContent("Could not load omitted context");
		expect(text()).toHaveTextContent("new a.ts");
		expect(report).toHaveBeenCalledExactlyOnceWith("Unexpected Forge failure", expect.any(Error));
		await user.click(screen.getByRole("button", { name: "Split" }));
		await user.click(screen.getByRole("button", { name: "Code", pressed: true }));
		expect(file().getByRole("alert")).toHaveTextContent("short diff remains available");
		expect(report).toHaveBeenCalledTimes(1);
		network.use(http.get("http://localhost/api/changes/file", () => Response.json(all)));
		await user.click(file().getByRole("button", { name: "Retry context" }));
		await waitFor(() => expect(text().textContent).toContain("context 1\n"));
		expect(file().queryByRole("alert")).not.toBeInTheDocument();
		expect(report).toHaveBeenCalledTimes(1);
	} finally {
		report.mockRestore();
	}
});
