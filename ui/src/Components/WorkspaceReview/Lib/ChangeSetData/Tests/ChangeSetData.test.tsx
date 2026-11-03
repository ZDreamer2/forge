// @vitest-environment jsdom
import type { WorkspaceFileDiff } from "@forge/api-contract";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it, vi } from "vitest";
import { useChangeSetAnalysis, useSelectedFile } from "../ChangeSetData";

const suite = createTestSuiteLifecycle({
	browser: {},
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

function textFile(path: string, patch: string, context: 3 | "all" = 3): WorkspaceFileDiff {
	return {
		kind: "text",
		path,
		patch,
		context,
		repo: ".",
		baseline: { kind: "unborn" },
		codebases: {},
		changeKind: "modified",
		base: { path, present: true, kind: "file", mode: "100644" },
		current: { path, present: true, kind: "file", mode: "100644" },
		statistics: { added: 1, removed: 1, binary: false },
	};
}

function useFileReader(path: string) {
	const selected = useSelectedFile(path);
	return { ...selected, file: { ...selected.file }, complete: { ...selected.complete } };
}

function readers() {
	const queryClient = suite.createQueryClient();
	return {
		queryClient,
		wrapper: ({ children }: { children: React.ReactNode }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	};
}

it("encodes canonical unusual paths and coalesces independent short and complete readers", async () => {
	const path = 'repo/雪 & # ?% "file".ts';
	const network = suite.createHttpScenario();
	const short = network.deferResponse();
	const all = network.deferResponse();
	const requests: string[] = [];
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			const url = new URL(request.url);
			expect(url.searchParams.get("path")).toBe(path);
			const context = url.searchParams.get("context");
			requests.push(context ?? "");
			return (context === "all" ? all : short).handle(request);
		}),
	);
	const { wrapper } = readers();
	const first = renderHook(() => useFileReader(path), { wrapper });
	const second = renderHook(() => useFileReader(path), { wrapper });
	await waitFor(() => expect(short.request).toBeDefined());
	expect(requests).toEqual(["3"]);
	await act(async () => short.release(Response.json(textFile(path, "short"))));
	await waitFor(() => expect(first.result.current.file.data).toEqual(textFile(path, "short")));
	let expansion!: ReturnType<typeof first.result.current.loadComplete>;
	let repeated!: ReturnType<typeof second.result.current.loadComplete>;
	act(() => {
		expansion = first.result.current.loadComplete();
		repeated = second.result.current.loadComplete();
	});
	await waitFor(() => expect(all.request).toBeDefined());
	expect(first.result.current.file.data).toEqual(textFile(path, "short"));
	await act(async () => {
		all.release(Response.json(textFile(path, "complete", "all")));
		await Promise.all([expansion, repeated]);
	});
	expect(requests).toEqual(["3", "all"]);
	await waitFor(() => expect(second.result.current.complete.data).toEqual(textFile(path, "complete", "all")));
});

it("disposes old selection requests and ignores an abort-ignoring late completion", async () => {
	const late = suite.defer<Response>({
		label: "obsolete selected file",
		unfinished: { type: "resolve", value: Response.json(textFile("a", "late")) },
	});
	const requests: AbortSignal[] = [];
	const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
		const url = new URL(String(input));
		if (url.searchParams.get("path") === "a") {
			requests.push(options?.signal as AbortSignal);
			return late.promise;
		}
		return Response.json(textFile("b", "current"));
	});
	const { wrapper, queryClient } = readers();
	try {
		const { result, rerender, unmount } = renderHook(({ path }) => useFileReader(path), {
			wrapper,
			initialProps: { path: "a" },
		});
		await waitFor(() => expect(requests).toHaveLength(1));
		rerender({ path: "b" });
		await waitFor(() => expect(result.current.file.data).toEqual(textFile("b", "current")));
		expect(requests[0]?.aborted).toBe(true);
		await act(async () => late.resolve(Response.json(textFile("a", "late"))));
		expect(result.current.file.data).toEqual(textFile("b", "current"));
		unmount();
		// Query's zero-delay inactive retention is a third-party cache timer.
		await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
	} finally {
		fetch.mockRestore();
	}
});

it("a same-path reload retires complete context and requires a fresh complete read", async () => {
	let shortCalls = 0;
	let completeCalls = 0;
	suite.createHttpScenario(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			const all = new URL(request.url).searchParams.get("context") === "all";
			return Response.json(textFile("a", String(all ? ++completeCalls : ++shortCalls), all ? "all" : 3));
		}),
	);
	const { wrapper } = readers();
	const { result } = renderHook(() => useFileReader("a"), { wrapper });
	await waitFor(() => expect(result.current.file.isSuccess).toBe(true));
	await act(async () => {
		await result.current.loadComplete();
	});
	await waitFor(() => expect(result.current.complete.isSuccess).toBe(true));
	await act(async () => {
		await result.current.reload();
	});
	await waitFor(() => expect(result.current.complete.data).toBeUndefined());
	expect(result.current.file.data).toEqual(textFile("a", "2"));
	expect(completeCalls).toBe(1);
	await act(async () => {
		await result.current.loadComplete();
	});
	await waitFor(() => expect(result.current.complete.data).toEqual(textFile("a", "2", "all")));
});

it("selection disposal cancels both short and complete work and revisits read again", async () => {
	const network = suite.createHttpScenario();
	const complete = network.deferResponse();
	let calls = 0;
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			const url = new URL(request.url);
			if (url.searchParams.get("context") === "all") return complete.handle(request);
			calls++;
			const path = url.searchParams.get("path") ?? "";
			return Response.json(textFile(path, String(calls)));
		}),
	);
	const { wrapper } = readers();
	const { result, rerender } = renderHook(({ path }) => useFileReader(path), { wrapper, initialProps: { path: "a" } });
	await waitFor(() => expect(result.current.file.isSuccess).toBe(true));
	act(() => {
		void result.current.loadComplete();
	});
	await waitFor(() => expect(complete.request).toBeDefined());
	rerender({ path: "b" });
	await waitFor(() => expect(result.current.file.data).toEqual(textFile("b", "2")));
	expect(complete.request?.signal.aborted).toBe(true);
	rerender({ path: "a" });
	await waitFor(() => expect(result.current.file.data).toEqual(textFile("a", "3")));
	expect(result.current.complete.data).toBeUndefined();
});

it("Refresh cancels obsolete complete work and awaits analysis plus the active short read", async () => {
	const network = suite.createHttpScenario();
	const obsolete = network.deferResponse();
	let fileCalls = 0;
	network.use(
		http.get("http://localhost/api/changes/analysis", () => Response.json(facts)),
		http.get("http://localhost/api/changes/file", ({ request }) => {
			if (new URL(request.url).searchParams.get("context") === "all") return obsolete.handle(request);
			return Response.json(textFile("a", String(++fileCalls)));
		}),
	);
	const { wrapper } = readers();
	const { result } = renderHook(() => ({ changes: useChangeSetAnalysis(), selected: useFileReader("a") }), { wrapper });
	await waitFor(() => expect(result.current.selected.file.isSuccess).toBe(true));
	act(() => {
		void result.current.selected.loadComplete();
	});
	await waitFor(() => expect(obsolete.request).toBeDefined());
	const refreshed = network.deferResponse();
	network.use(http.get("http://localhost/api/changes/file", ({ request }) => refreshed.handle(request)));
	let finished = false;
	act(() => {
		void result.current.changes.refresh("a").then(() => {
			finished = true;
		});
	});
	await waitFor(() => expect(refreshed.request).toBeDefined());
	expect(obsolete.request?.signal.aborted).toBe(true);
	expect(finished).toBe(false);
	expect(result.current.selected.file.data).toEqual(textFile("a", "1"));
	expect(result.current.changes.updating).toBe(true);
	await act(async () => refreshed.release(Response.json(textFile("a", "fresh"))));
	await waitFor(() => expect(finished).toBe(true));
	expect(result.current.selected.file.data).toEqual(textFile("a", "fresh"));
	expect(result.current.selected.complete.data).toBeUndefined();
});

it("keeps failures independent, preserves short content on context failure and retries explicitly", async () => {
	const network = suite.createHttpScenario();
	let analysisCalls = 0;
	let fileCalls = 0;
	let completeCalls = 0;
	network.use(
		http.get("http://localhost/api/changes/analysis", () => {
			analysisCalls++;
			return new Response("unavailable", { status: 503 });
		}),
		http.get("http://localhost/api/changes/file", ({ request }) => {
			if (new URL(request.url).searchParams.get("context") === "all") {
				completeCalls++;
				return new Response("context unavailable", { status: 503 });
			}
			fileCalls++;
			return Response.json(textFile("a", "short"));
		}),
	);
	const { wrapper } = readers();
	const { result } = renderHook(() => ({ changes: useChangeSetAnalysis(), selected: useFileReader("a") }), { wrapper });
	await waitFor(() => expect(result.current.changes.analysis.isError).toBe(true));
	await waitFor(() => expect(result.current.selected.file.isSuccess).toBe(true));
	await act(async () => {
		await result.current.selected.loadComplete();
	});
	await waitFor(() => expect(result.current.selected.complete.isError).toBe(true));
	expect(result.current.selected.file.data).toEqual(textFile("a", "short"));
	expect([analysisCalls, fileCalls, completeCalls]).toEqual([1, 1, 1]);
	network.use(http.get("http://localhost/api/changes/file", () => Response.json(textFile("a", "complete", "all"))));
	await act(async () => {
		await result.current.selected.loadComplete();
	});
	await waitFor(() => expect(result.current.selected.complete.isSuccess).toBe(true));
	network.use(http.get("http://localhost/api/changes/file", () => new Response("offline", { status: 503 })));
	await act(async () => {
		await result.current.selected.reload();
	});
	await waitFor(() => expect(result.current.selected.file.isError).toBe(true));
	expect(result.current.selected.file.data).toEqual(textFile("a", "short"));
	expect(result.current.selected.complete.data).toBeUndefined();
	let blockedReads = 0;
	network.use(
		http.get("http://localhost/api/changes/file", () => {
			blockedReads++;
			return Response.json(textFile("a", "must not hydrate", "all"));
		}),
	);
	await act(async () => {
		await result.current.selected.loadComplete();
	});
	expect(blockedReads).toBe(0);
	expect(result.current.selected.complete.data).toBeUndefined();
	expect(analysisCalls).toBe(1);
	network.use(http.get("http://localhost/api/changes/file", () => Response.json(textFile("a", "retried"))));
	await act(async () => {
		await result.current.selected.reload();
	});
	await waitFor(() => expect(result.current.selected.file.data).toEqual(textFile("a", "retried")));
	expect(result.current.changes.analysis.isError).toBe(true);
});

it("reads and retries while offline without automatic reconnect or focus refreshes", async () => {
	let calls = 0;
	suite.createHttpScenario(
		http.get("http://localhost/api/changes/file", () => {
			calls++;
			return Response.json(textFile("a", String(calls)));
		}),
	);
	const { wrapper } = readers();
	onlineManager.setOnline(false);
	try {
		const { result } = renderHook(() => useFileReader("a"), { wrapper });
		await waitFor(() => expect(result.current.file.data).toEqual(textFile("a", "1")));
		await act(async () => {
			await result.current.reload();
		});
		await waitFor(() => expect(result.current.file.data).toEqual(textFile("a", "2")));
		await act(async () => {
			onlineManager.setOnline(true);
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(calls).toBe(2);
	} finally {
		onlineManager.setOnline(true);
	}
});

it("Refresh prevents an abort-ignoring obsolete complete result from resurfacing", async () => {
	const obsolete = suite.defer<Response>({
		label: "obsolete complete observation",
		unfinished: { type: "resolve", value: Response.json(textFile("a", "obsolete", "all")) },
	});
	let completeSignal: AbortSignal | undefined;
	let shortCalls = 0;
	let completeCalls = 0;
	const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith("/analysis")) return Response.json(facts);
		if (url.searchParams.get("context") === "all") {
			completeCalls++;
			if (completeCalls === 1) {
				completeSignal = options?.signal as AbortSignal;
				return obsolete.promise;
			}
			return Response.json(textFile("a", "fresh complete", "all"));
		}
		return Response.json(textFile("a", String(++shortCalls)));
	});
	const { wrapper } = readers();
	try {
		const { result } = renderHook(() => ({ changes: useChangeSetAnalysis(), selected: useFileReader("a") }), {
			wrapper,
		});
		await waitFor(() => expect(result.current.selected.file.isSuccess).toBe(true));
		let expansion!: ReturnType<typeof result.current.selected.loadComplete>;
		act(() => {
			expansion = result.current.selected.loadComplete();
		});
		await waitFor(() => expect(completeSignal).toBeDefined());
		await act(async () => {
			await result.current.changes.refresh("a");
		});
		await waitFor(() => expect(result.current.selected.file.data).toEqual(textFile("a", "2")));
		expect(completeSignal?.aborted).toBe(true);
		await act(async () => {
			obsolete.resolve(Response.json(textFile("a", "obsolete", "all")));
			await expansion;
		});
		expect(result.current.selected.complete.data).toBeUndefined();
		await act(async () => {
			await result.current.selected.loadComplete();
		});
		await waitFor(() => expect(result.current.selected.complete.data).toEqual(textFile("a", "fresh complete", "all")));
		expect(completeCalls).toBe(2);
	} finally {
		fetch.mockRestore();
	}
});

it("does not acquire complete context during a replacing short read or after selection disposal", async () => {
	const network = suite.createHttpScenario();
	let allCalls = 0;
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			const context = new URL(request.url).searchParams.get("context") === "all" ? "all" : 3;
			if (context === "all") allCalls++;
			return Response.json(textFile("a", "initial", context));
		}),
	);
	const { wrapper } = readers();
	const { result, unmount } = renderHook(() => useFileReader("a"), { wrapper });
	await waitFor(() => expect(result.current.file.isSuccess).toBe(true));
	await act(async () => {
		await result.current.loadComplete();
	});
	await waitFor(() => expect(result.current.complete.isSuccess).toBe(true));
	const replacing = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			if (new URL(request.url).searchParams.get("context") === "all") {
				allCalls++;
				return Response.json(textFile("a", "premature", "all"));
			}
			return replacing.handle(request);
		}),
	);
	let replacement!: ReturnType<typeof result.current.reload>;
	act(() => {
		replacement = result.current.reload();
	});
	await waitFor(() => expect(replacing.request).toBeDefined());
	await act(async () => {
		await result.current.loadComplete();
	});
	expect(allCalls).toBe(1);
	expect(result.current.complete.data).toBeUndefined();
	await act(async () => {
		replacing.release(Response.json(textFile("a", "replacement")));
		await replacement;
	});
	await waitFor(() => expect(result.current.file.data).toEqual(textFile("a", "replacement")));
	const disposedExpansion = result.current.loadComplete;
	unmount();
	await act(async () => {
		await disposedExpansion();
	});
	expect(allCalls).toBe(1);
});

it("concurrent comparison refreshes coalesce and omitted selection refreshes active short readers", async () => {
	const network = suite.createHttpScenario();
	let fileCalls = 0;
	let analysisCalls = 0;
	network.use(
		http.get("http://localhost/api/changes/analysis", () => {
			analysisCalls++;
			return Response.json(facts);
		}),
		http.get("http://localhost/api/changes/file", () => {
			fileCalls++;
			return Response.json(textFile("a", "initial"));
		}),
	);
	const { wrapper } = readers();
	const { result } = renderHook(() => ({ changes: useChangeSetAnalysis(), selected: useFileReader("a") }), { wrapper });
	await waitFor(() => expect(result.current.selected.file.isSuccess).toBe(true));
	await waitFor(() => expect(result.current.changes.analysis.isSuccess).toBe(true));
	const pending = network.deferResponse();
	network.use(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			fileCalls++;
			return pending.handle(request);
		}),
	);
	let first!: ReturnType<typeof result.current.changes.refresh>;
	let second!: ReturnType<typeof result.current.changes.refresh>;
	act(() => {
		first = result.current.changes.refresh();
		second = result.current.changes.refresh("a");
	});
	await waitFor(() => expect(pending.request).toBeDefined());
	expect(fileCalls).toBe(2);
	await act(async () => {
		pending.release(Response.json(textFile("a", "refreshed")));
		await Promise.all([first, second]);
	});
	await waitFor(() => expect(result.current.selected.file.data).toEqual(textFile("a", "refreshed")));
	expect(analysisCalls).toBe(2);
});

it("identifies identical successful short observations without relying on data identity or clock time", async () => {
	suite.createHttpScenario(http.get("http://localhost/api/changes/file", () => Response.json(textFile("a", "same"))));
	const { wrapper } = readers();
	const { result } = renderHook(() => useFileReader("a"), { wrapper });
	await waitFor(() => expect(result.current.file.isSuccess).toBe(true));
	const observation = result.current.observation;
	const first = result.current.file.data;
	await act(async () => {
		await result.current.reload();
	});
	await waitFor(() => expect(result.current.observation).toBe(observation + 1));
	expect(result.current.file.data).toBe(first);
});
