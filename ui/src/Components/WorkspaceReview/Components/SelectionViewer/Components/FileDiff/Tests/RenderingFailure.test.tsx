// @vitest-environment jsdom
import type { AnalysisWireNode } from "@forge/api-contract";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestSuiteLifecycle } from "@zdreamer/forge-ts-react-frontend/testing";
import { http } from "msw";
import { expect, it, vi } from "vitest";
import { fileObservation } from "../../../../../../../Lib/Testing/Testing";
import { ForgeTheme } from "../../../../../../ForgeTheme/ForgeTheme";
import { FileDiff, FileDiffScope } from "../FileDiff";
import * as renderer from "../Internal/pierreRenderer";

vi.mock("../Internal/pierreRenderer", async () =>
	(await import("../../../../../../../Lib/Testing/Testing")).rendererBoundary(),
);

const suite = createTestSuiteLifecycle({
	browser: { documentAttributes: ["data-mantine-color-scheme"] },
	beforeCancel: [() => cleanup()],
	runCleanup: (finish) => act(finish),
});

const summary: AnalysisWireNode = {
	path: "file.ts",
	kind: "modified",
	repo: ".",
	children: [],
	base: { path: "file.ts", kind: "file", repository: "." },
	current: { path: "file.ts", kind: "file", repository: "." },
	classification: { value: "code" },
	effectiveEmphasis: { value: "normal" },
	signals: [],
	signalCounts: { warning: 0, notice: 0 },
	rawTotals: { added: 1, removed: 1 },
	attentionTotals: { added: 1, removed: 1 },
	statistics: { added: 1, removed: 1, binary: false },
};

it("contains an asynchronous highlighter rejection and recovers through explicit reload", async () => {
	let reads = 0;
	const longLine = `    ${"word ".repeat(300)}${"token".repeat(300)} END-OF-LONG-LINE`;
	suite.createHttpScenario(
		http.get("http://localhost/api/changes/file", ({ request }) => {
			const query = new URL(request.url).searchParams;
			if (query.get("path") !== summary.path || query.get("context") !== "3")
				throw new Error(`Unexpected file request: ${request.url}`);
			reads++;
			const observation = fileObservation(summary, {
				root: ".",
				nodes: { "file.ts": summary },
				codebases: {},
				handlers: {},
			});
			if (reads === 1 && observation.kind === "text")
				observation.patch = observation.patch.replace("+new file.ts 0", `+new file.ts ${longLine}`);
			return Response.json(observation);
		}),
	);
	const pending = suite.defer<void>({
		label: "selected-file highlighter",
		unfinished: { type: "resolve", value: undefined },
	});
	const prepare = vi.spyOn(renderer, "prepareHighlight").mockImplementationOnce(() => pending.promise);
	const report = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const user = userEvent.setup();
		render(
			<QueryClientProvider client={suite.createQueryClient()}>
				<ForgeTheme env="test">
					<FileDiffScope>
						<section aria-label="Selection metadata">Selected file.ts</section>
						<FileDiff path="file.ts" summary={summary} onRefresh={() => {}} />
					</FileDiffScope>
				</ForgeTheme>
			</QueryClientProvider>,
		);
		const file = within(screen.getByRole("region", { name: "File diff" }));
		await waitFor(() => expect(prepare).toHaveBeenCalled());
		await act(async () => pending.reject(new Error("highlighter unavailable")));
		expect(await file.findByRole("alert")).toHaveTextContent("could not be rendered");
		expect(report).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith("Unexpected Forge failure", expect.any(Error));
		expect(screen.getByRole("region", { name: "Selection metadata" })).toHaveTextContent("Selected file.ts");
		await user.click(file.getByRole("button", { name: "Show plain patch" }));
		expect(file.getByRole("region", { name: "Plain text patch" }).querySelector("pre")?.textContent).toContain(
			`+new file.ts ${longLine}\n`,
		);
		await user.click(file.getByRole("button", { name: "Hide plain patch" }));
		expect(file.queryByRole("region", { name: "Plain text patch" })).not.toBeInTheDocument();
		await user.click(file.getByRole("button", { name: "Show plain patch" }));
		expect(file.getByRole("region", { name: "Plain text patch" }).querySelector("pre")?.textContent).toContain(
			`+new file.ts ${longLine}\n`,
		);
		expect(report).toHaveBeenCalledTimes(1);
		await user.click(file.getByRole("button", { name: "Reload file" }));
		await waitFor(() => expect(screen.getByLabelText("Rendered diff text")).toHaveTextContent("new file.ts"));
		expect(file.queryByRole("alert")).not.toBeInTheDocument();
		expect(reads).toBe(2);
		expect(report).toHaveBeenCalledTimes(1);
	} finally {
		prepare.mockRestore();
		report.mockRestore();
	}
});
