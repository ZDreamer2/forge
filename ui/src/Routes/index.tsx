import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceReview } from "../Components/WorkspaceReview/WorkspaceReview";

type SelectionSearch = { path?: string; invalidSelection?: boolean };

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>): SelectionSearch => {
		if (search.path === undefined) return {};
		const path = search.path;
		if (
			typeof path !== "string" ||
			!path ||
			(path !== "." && path.split("/").some((part) => !part || part === "." || part === "..")) ||
			/^[A-Za-z]:[\\/]/.test(path) ||
			path.includes("\0")
		)
			return { invalidSelection: true };
		return { path };
	},
	component: WorkspacePage,
});

function WorkspacePage() {
	const { path, invalidSelection } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<WorkspaceReview
			selectedPath={path}
			invalidSelection={invalidSelection}
			onNavigate={(nextPath, replace = false) => {
				void navigate({ to: "/", search: nextPath === undefined ? {} : { path: nextPath }, replace });
			}}
		/>
	);
}
