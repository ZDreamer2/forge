// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it } from "vitest";
import { useWorkspaceIdentity } from "../WorkspaceData";

const suite = createTestSuiteLifecycle({
	beforeCancel: [() => cleanup()],
	runCleanup: (finish) => act(finish),
});

it("reads identity independently and retains prior data when explicit refresh fails", async () => {
	let calls = 0;
	const network = suite.createHttpScenario(
		http.get("http://localhost/api/workspace", () => {
			calls++;
			return Response.json({ workspace: { name: "repo", root: "/repo" }, repositories: [] });
		}),
	);
	const queryClient = suite.createQueryClient();
	const { result } = renderHook(() => useWorkspaceIdentity(), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
	await waitFor(() => expect(result.current.workspace.data?.workspace.name).toBe("repo"));
	network.use(
		http.get("http://localhost/api/workspace", () => {
			calls++;
			return new Response("unavailable", { status: 503 });
		}),
	);
	await act(async () => {
		await result.current.refresh();
	});
	await waitFor(() => expect(result.current.workspace.isError).toBe(true));
	expect(result.current.workspace.data?.workspace.name).toBe("repo");
	expect(calls).toBe(2);
});

it("cancels its pending read when the last identity observer leaves", async () => {
	const network = suite.createHttpScenario();
	const response = network.deferResponse();
	network.use(http.get("http://localhost/api/workspace", ({ request }) => response.handle(request)));
	const queryClient = suite.createQueryClient();
	const { unmount } = renderHook(() => useWorkspaceIdentity(), {
		wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	});
	await waitFor(() => expect(response.request).toBeDefined());
	unmount();
	await waitFor(() => expect(response.state).toBe("cancelled"));
});
