import { Button, Tooltip } from "@mantine/core";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ChangesNavigator } from "./Components/ChangesNavigator/ChangesNavigator";
import { ChangesSummary } from "./Components/ChangesSummary/ChangesSummary";
import { SelectionViewer } from "./Components/SelectionViewer/SelectionViewer";
import emblem from "./Internal/Assets/forge-emblem.svg";
import { analyzeChanges, importanceOf, initialFilters, resolveSelection } from "./Internal/changeAnalysis";
import type { PathRequest } from "./Internal/pathRequest";
import { analyzeSignals } from "./Internal/signalAnalysis";
import { useChangeSetAnalysis } from "./Lib/ChangeSetData/ChangeSetData";
import { useWorkspaceIdentity } from "./Lib/WorkspaceData/WorkspaceData";
import styles from "./WorkspaceReview.module.css";

type Props = {
	selectedPath?: string | undefined;
	invalidSelection?: boolean | undefined;
	onNavigate: (path: string | undefined, replace?: boolean) => void;
};

export function WorkspaceReview({ selectedPath, invalidSelection, onNavigate }: Props) {
	const workspaceData = useWorkspaceIdentity();
	const changeSetData = useChangeSetAnalysis();
	const { workspace } = workspaceData;
	const { analysis } = changeSetData;
	const updating = workspaceData.updating || changeSetData.updating;
	const [filters, setFilters] = useState(initialFilters);
	const [inspectionRequest, setInspectionRequest] = useState<PathRequest>();
	const [revealRequest, setRevealRequest] = useState<PathRequest>();
	const requestOccurrence = useRef(0);
	const [notice, setNotice] = useState("");
	const [copyFeedback, setCopyFeedback] = useState("");
	const copyAttempt = useRef(0);
	const [viewport, setViewport] = useState(() => window.innerWidth);
	const [sidebarWidth, setSidebarWidth] = useState(() => {
		try {
			const saved = Number(window.localStorage.getItem("forge-sidebar-width"));
			return Number.isFinite(saved) && saved > 0 ? saved : 390;
		} catch {
			return 390;
		}
	});
	const sidebarMin = Math.min(240, Math.floor(viewport * 0.55));
	const sidebarMax = Math.max(sidebarMin, Math.min(600, viewport - Math.min(280, viewport * 0.4)));
	const width = Math.max(sidebarMin, Math.min(sidebarMax, sidebarWidth));
	// memo-reason: canonical subtree and repository summaries traverse all entries;
	// divider drags and clipboard acknowledgements must reuse the same derived facts.
	const review = useMemo(
		() => analyzeChanges(analysis.data, workspace.data, filters),
		[analysis.data, workspace.data, filters],
	);

	// memo-reason: signal indexing traverses canonical nodes; filter and layout changes reuse it.
	const signals = useMemo(() => analyzeSignals(analysis.data), [analysis.data]);

	useEffect(() => {
		const resize = () => setViewport(window.innerWidth);
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, []);

	useEffect(() => {
		if (invalidSelection) {
			setNotice("Invalid selection address. Use a normalized workspace-relative path, or . for the root.");
			onNavigate(undefined, true);
		} else if (
			selectedPath !== undefined &&
			workspace.isSuccess &&
			analysis.isSuccess &&
			!updating &&
			!resolveSelection(review, selectedPath)
		) {
			setNotice(`Selection is unavailable: ${selectedPath}. It may have disappeared since the previous observation.`);
			onNavigate(undefined, true);
		}
	}, [invalidSelection, selectedPath, workspace.isSuccess, analysis.isSuccess, updating, review, onNavigate]);

	function resizeSidebar(next: number) {
		const preferred = Math.max(sidebarMin, Math.min(sidebarMax, next));
		setSidebarWidth(preferred);
		try {
			window.localStorage.setItem("forge-sidebar-width", String(preferred));
		} catch {
			// Storage can be unavailable; the current view must still resize.
		}
	}

	function inspect(path: string, reveal = false) {
		const request = { path, occurrence: ++requestOccurrence.current };
		setInspectionRequest(request);
		setRevealRequest(reveal ? request : undefined);
		setNotice("");
		if (reveal) {
			const node = review.subjects.get(path)?.node;
			if (node?.kind)
				setFilters((current) => ({
					types: new Set([...current.types, node.classification.value]),
					importance: new Set([...current.importance, importanceOf(node)]),
				}));
		}
		if (path !== selectedPath) onNavigate(path);
	}

	function select(path: string, copy: boolean) {
		setInspectionRequest(undefined);
		setRevealRequest(undefined);
		setNotice("");
		setCopyFeedback("");
		onNavigate(!copy && path === selectedPath ? undefined : path);
		++copyAttempt.current;
		if (copy) copyPath(path);
	}

	function copyPath(path: string) {
		setCopyFeedback("");
		const attempt = ++copyAttempt.current;
		void (async () => {
			try {
				await navigator.clipboard.writeText(path);
			} catch {
				if (attempt === copyAttempt.current) setCopyFeedback("Could not copy path. Clipboard access is unavailable.");
			}
		})();
	}

	const root = analysis.data?.nodes["."];
	const selectedEntry = selectedPath ? review.subjects.get(selectedPath)?.node : undefined;
	const refresh = () =>
		Promise.all([workspaceData.refresh(), changeSetData.refresh(selectedEntry?.kind ? selectedPath : undefined)]);
	return (
		<main className={styles.review} style={{ "--sidebar-width": `${width}px` } as CSSProperties}>
			<header className={styles.header} data-workspace-header>
				<div className={styles.identity}>
					<img src={emblem} alt="Forge" width={34} height={36} />
					<h1 title={workspace.data?.workspace.root}>{workspace.data?.workspace.name ?? "Workspace"}</h1>
				</div>
				<div className={styles.headerMain}>
					{analysis.data && (
						<ChangesSummary
							summary={{ ...review.all, ...(root?.rawTotals ?? {}) }}
							label="All workspace changes"
							files
						/>
					)}
					<Button
						className={styles.refresh}
						variant="default"
						leftSection={<span aria-hidden="true">↻</span>}
						disabled={updating}
						onClick={() => void refresh()}
					>
						Refresh
					</Button>
					<Tooltip
						label="Click a name to select or clear. Ctrl+Click selects and copies its path. Use Left/Right on the divider to resize."
						events={{ hover: true, focus: true, touch: false }}
					>
						<Button className={styles.help} variant="subtle" size="compact-xs" color="gray" aria-label="Keyboard help">
							⌨︎
						</Button>
					</Tooltip>
				</div>
			</header>
			<div className={styles.feedback}>
				{updating && <p role="status">{workspace.data || analysis.data ? "Updating…" : "Loading workspace…"}</p>}
				{workspace.isError && (
					<div role="alert">
						{workspace.data ? "Workspace identity is stale. " : ""}Could not load workspace identity.{" "}
						<Button
							size="compact-xs"
							variant="subtle"
							disabled={workspace.isFetching}
							onClick={() => void workspaceData.refresh()}
						>
							Retry workspace
						</Button>
					</div>
				)}
				{analysis.isError && (
					<div role="alert">
						{analysis.data ? "Change summary is stale. " : ""}Could not load change summary.{" "}
						<Button
							size="compact-xs"
							variant="subtle"
							disabled={analysis.isFetching}
							onClick={() => void changeSetData.refresh()}
						>
							Retry changes
						</Button>
					</div>
				)}
				{notice && <p role="status">{notice}</p>}
				{copyFeedback && <p role="status">{copyFeedback}</p>}
			</div>
			<ChangesNavigator
				review={review}
				analysis={analysis.data}
				identity={workspace.data}
				filters={filters}
				onFiltersChange={setFilters}
				selectedPath={selectedPath}
				onSelect={select}
				signals={signals}
				onInspect={inspect}
				revealRequest={revealRequest}
			/>
			<hr
				className={styles.divider}
				tabIndex={0}
				aria-label="Resize changes sidebar"
				aria-orientation="vertical"
				aria-valuemin={sidebarMin}
				aria-valuemax={sidebarMax}
				aria-valuenow={Math.round(width)}
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					event.preventDefault();
				}}
				onPointerMove={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSidebar(event.clientX);
				}}
				onPointerUp={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						event.currentTarget.releasePointerCapture(event.pointerId);
				}}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
						event.preventDefault();
						resizeSidebar(width + (event.key === "ArrowLeft" ? -20 : 20));
					}
				}}
			/>
			<div className={styles.details}>
				{analysis.data ? (
					<SelectionViewer
						onRefresh={() => void refresh()}
						review={review}
						selectedPath={selectedPath}
						codebases={analysis.data.codebases}
						guidance={analysis.data.guidance}
						onCopyPath={copyPath}
						signals={signals}
						inspectionRequest={inspectionRequest}
						onInspect={inspect}
						onSourceNavigate={inspect}
						onFolderNavigate={(path) => {
							if (path !== selectedPath) select(path, false);
						}}
						onReveal={(path) => inspect(path, true)}
					/>
				) : (
					<p>Waiting for change analysis.</p>
				)}
			</div>
		</main>
	);
}
