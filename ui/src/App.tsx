import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { ForgeTheme } from "./Components/ForgeTheme/ForgeTheme";
import { reportUnexpectedError } from "./Lib/Report/Report";
import { routeTree } from "./Routes/routeTree.gen";

export default function App({ queryClient, env }: { queryClient?: QueryClient; env?: "test" }) {
	const [client] = useState(() => queryClient ?? new QueryClient());
	const [router] = useState(createAppRouter);

	return (
		<ForgeTheme {...(env ? { env } : {})}>
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ForgeTheme>
	);
}

function createAppRouter() {
	return createRouter({
		routeTree,
		parseSearch: parseAddressSearch,
		stringifySearch: stringifyAddressSearch,
		defaultOnCatch: reportUnexpectedError,
		defaultErrorComponent: RouteFailure,
		defaultNotFoundComponent: () => <p>This workspace page does not exist.</p>,
	});
}

function RouteFailure() {
	return (
		<div role="alert">
			<p>The workspace page could not be displayed.</p>
			<button type="button" onClick={() => window.location.reload()}>
				Reload Forge
			</button>
		</div>
	);
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createAppRouter>;
	}
}

// File names are literal strings. JSON search coercion would change names such as
// `123`, `true` or `"quoted"` before the route can validate their identity.
function parseAddressSearch(search: string): Record<string, unknown> {
	const result: Record<string, unknown> = Object.create(null);
	for (const [key, value] of new URLSearchParams(search)) {
		if (Object.hasOwn(result, key)) {
			const previous = result[key];
			result[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
		} else result[key] = value;
	}
	// URLSearchParams repairs malformed escapes; retain an invalid value for validation.
	for (const part of search.replace(/^\?/, "").split("&")) {
		const [key, ...value] = part.split("=");
		try {
			decodeURIComponent(value.join("=").replace(/\+/g, " "));
		} catch {
			result[new URLSearchParams(`${key}=`).keys().next().value ?? ""] = [];
		}
	}
	return result;
}

function stringifyAddressSearch(search: Record<string, unknown>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(search)) {
		if (value !== undefined) params.set(key, String(value));
	}
	const text = params.toString();
	return text ? `?${text}` : "";
}
