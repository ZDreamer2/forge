import { createRoot } from "react-dom/client";
import App from "./App";
import { FinalBoundary } from "./Components/FinalBoundary/FinalBoundary";
import { reportUnexpectedError } from "./Lib/Report/Report";

window.addEventListener("error", (event) => reportUnexpectedError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => reportUnexpectedError(event.reason));

const mount = document.getElementById("root");
if (!mount) throw new Error("Forge root mount is missing");

createRoot(mount, {
	onCaughtError: () => {},
	onUncaughtError: reportUnexpectedError,
	onRecoverableError: reportUnexpectedError,
}).render(
	<FinalBoundary>
		<App />
	</FinalBoundary>,
);
