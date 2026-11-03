// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it } from "vitest";
import { useChangeSetAnalysis } from "../ChangeSetData";

const suite = createTestSuiteLifecycle({
	beforeCancel: [() => cleanup()],
	runCleanup: (finish) => act(finish),
});
const facts = { root: ".", codebases: {}, handlers: {}, nodes: {} };

it("reads analysis independently and coalesces refresh with initial and retained-data reads", async () => {
	const network = suite.createHttpScenario();
	const initial = network.deferResponse();
	let calls = 0;
	network.use(
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			calls++;
			return initial.handle(request);
		}),
	);
	const queryClient = suite.createQueryClient();
	const { result } = renderHook(() => useChangeSetAnalysis(), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
	await waitFor(() => expect(initial.request).toBeDefined());
	const refresh = result.current.refresh();
	await act(async () => {
		initial.release(Response.json(facts));
		await refresh;
	});
	await waitFor(() => expect(result.current.analysis.data?.root).toBe("."));
	expect(calls).toBe(1);

	const pending = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/analysis", ({ request }) => {
			calls++;
			return pending.handle(request);
		}),
	);
	let first!: ReturnType<typeof result.current.refresh>;
	let second!: ReturnType<typeof result.current.refresh>;
	act(() => {
		first = result.current.refresh();
		second = result.current.refresh();
	});
	await waitFor(() => expect(pending.request).toBeDefined());
	expect(result.current.analysis.data?.root).toBe(".");
	await act(async () => {
		pending.release(Response.json(facts));
		await Promise.all([first, second]);
	});
	expect(calls).toBe(2);
});

it("starts on subscription and leaves a failed read local without an automatic retry", async () => {
	let calls = 0;
	suite.createHttpScenario(
		http.get("http://localhost/api/changes/analysis", () => {
			calls++;
			return new Response("offline", { status: 503 });
		}),
	);
	const queryClient = suite.createQueryClient();
	expect(calls).toBe(0);
	const { result } = renderHook(() => useChangeSetAnalysis(), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
	await waitFor(() => expect(result.current.analysis.isError).toBe(true));
	expect(result.current.updating).toBe(false);
	expect(result.current.analysis.failureCount).toBe(1);
	expect(calls).toBe(1);
});
