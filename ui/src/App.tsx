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
