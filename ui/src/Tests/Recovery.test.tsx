// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import App from "../App";
import { FinalBoundary } from "../Components/FinalBoundary/FinalBoundary";

vi.mock("../Components/WorkspaceOverview/WorkspaceOverview", () => ({
	WorkspaceOverview: () => {
		throw new Error("unexpected route render failure");
	},
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
function BrokenProviders(): never {
	throw new Error("provider construction failed");
}

it("contains provider construction failures independently, reports once and offers document recovery", async () => {
	const reports = vi.spyOn(console, "error").mockImplementation(() => {});
	const reload = vi.fn();
	render(
		<FinalBoundary reload={reload}>
			<BrokenProviders />
		</FinalBoundary>,
		{ onCaughtError: () => {} },
	);
	expect(screen.getByRole("alert")).toHaveTextContent("Forge could not start");
	expect(reports).toHaveBeenCalledExactlyOnceWith("Unexpected Forge failure", expect.any(Error));
	await userEvent.setup().click(screen.getByRole("button", { name: "Reload Forge" }));
	expect(reload).toHaveBeenCalledOnce();
});

it("retains recovery when its console reporting destination fails", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {
		throw new Error("console unavailable");
	});
	const reload = vi.fn();
	render(
		<FinalBoundary reload={reload}>
			<BrokenProviders />
		</FinalBoundary>,
		{ onCaughtError: () => {} },
	);
	await userEvent.setup().click(screen.getByRole("button", { name: "Reload Forge" }));
	expect(reload).toHaveBeenCalledOnce();
});

it("contains the delivered route and delegates its unexpected report to the app owner", async () => {
	const reports = vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	render(<App env="test" />, { onCaughtError: () => {} });
	expect(await screen.findByRole("alert")).toHaveTextContent("The workspace page could not be displayed.");
	expect(screen.getByRole("button", { name: "Reload Forge" })).toBeEnabled();
	expect(reports).toHaveBeenCalledExactlyOnceWith("Unexpected Forge failure", expect.any(Error));
});
