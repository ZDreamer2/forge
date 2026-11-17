import type { WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { ActionIcon, Tooltip } from "@mantine/core";
import { useMemo, useState } from "react";
import type { Filters, ReviewAnalysis } from "../../Internal/changeAnalysis";
import type { PathRequest } from "../../Internal/pathRequest";
import type { SignalAnalysis } from "../../Internal/signalAnalysis";
import { ChangesSummary } from "../ChangesSummary/ChangesSummary";
import styles from "./ChangesNavigator.module.css";
import { ChangeFilters } from "./Components/ChangeFilters/ChangeFilters";
import { ChangesTree } from "./Components/ChangesTree/ChangesTree";
import { expansionVisibleSummary, projectTree } from "./Internal/treeProjection";
import { useExpansion } from "./Internal/useExpansion";

type Props = {
	onRefresh: () => void;
	updating: boolean;
	signals?: SignalAnalysis | undefined;
	onInspect?: ((path: string) => void) | undefined;
	revealRequest?: PathRequest | undefined;
	review: ReviewAnalysis;
	analysis: WorkspaceAnalysis | undefined;
	identity: WorkspaceIdentity | undefined;
	filters: Filters;
	onFiltersChange: (filters: Filters) => void;
	selectedPath: string | undefined;
	onSelect: (path: string, copy: boolean) => void;
};

// Keep this instance mounted across addresses and refreshes: expansion belongs to
// the navigation session, not to the selected subject's lifetime.
export function ChangesNavigator({
	review,
	analysis,
	identity,
	filters,
	onFiltersChange,
	selectedPath,
	onSelect,
	signals,
	onInspect,
	revealRequest,
	onRefresh,
	updating,
}: Props) {
	// memo-reason: hierarchy/style projection traverses the complete canonical tree;
	// divider and clipboard updates in the composing review do not change its inputs.
	const projection = useMemo(() => projectTree(review), [review]);
	const expansion = useExpansion(projection, selectedPath, revealRequest);
	const [showFolderCounters, setShowFolderCounters] = useState(() => {
		try {
			return localStorage.getItem("forge-folder-counters") === "true";
		} catch {
			return false;
		}
	});
	function toggleFolderCounters() {
		const visible = !showFolderCounters;
		setShowFolderCounters(visible);
		try {
			localStorage.setItem("forge-folder-counters", String(visible));
		} catch {
			// The preference remains usable when browser storage is unavailable.
		}
	}
	return (
		<aside className={styles.sidebar} aria-label="Changes navigator">
			<ChangeFilters
				filters={filters}
				onChange={onFiltersChange}
				showFolderCounters={showFolderCounters}
				onToggleFolderCounters={toggleFolderCounters}
			/>
			<div className={styles.treeScroll} data-testid="changes-scroll">
				<div className={styles.heading}>
					<div className={styles.headingText}>
						{analysis && (
							<div className={styles.actions}>
								<button type="button" aria-label="Collapse all" onClick={expansion.collapseAll}>
									⊟
								</button>
								<button type="button" aria-label="Expand all" onClick={expansion.expandAll}>
									⊞
								</button>
							</div>
						)}
						<h2>Changes</h2>
						<Tooltip
							label="Refresh the workspace identity, change summary and active file."
							events={{ hover: true, focus: true, touch: true }}
						>
							<ActionIcon
								variant="subtle"
								color="gray"
								size="sm"
								aria-label="Refresh"
								disabled={updating}
								onClick={onRefresh}
							>
								↻
							</ActionIcon>
						</Tooltip>
						{analysis && (
							<span className={styles.matching}>
								{projection.visible.files} of {projection.all.files}
							</span>
						)}
					</div>
					{analysis && (
						<div className={styles.shown}>
							<Tooltip
								multiline
								events={{ hover: true, focus: true, touch: true }}
								classNames={{ tooltip: styles.tooltip }}
								label="Matching files outside collapsed folders. Collapsed descendants are excluded; scrolling does not affect this total."
							>
								<button type="button" className={styles.shownHelp}>
									Shown
								</button>
							</Tooltip>
							<ChangesSummary summary={expansionVisibleSummary(projection, expansion.expanded)} label="Shown changes" />
						</div>
					)}
				</div>
				{analysis ? (
					<ChangesTree
						projection={projection}
						showFolderCounters={showFolderCounters}
						workspaceName={identity?.workspace.name ?? "."}
						signals={signals}
						onInspect={onInspect}
						expanded={expansion.expanded}
						selectedPath={selectedPath}
						codebases={analysis.codebases}
						onSelect={onSelect}
						onToggle={expansion.toggle}
					/>
				) : (
					<div className={styles.unknown}>
						<p>Change summary is unavailable.</p>
						{identity && (
							<nav aria-label="Registered repositories">
								{identity.repositories.map((repository) => (
									<div key={repository.path}>
										<button
											type="button"
											aria-label={`Select ${repository.path}`}
											aria-pressed={selectedPath === repository.path}
											onClick={(event) => onSelect(repository.path, event.ctrlKey)}
										>
											{repository.path}
										</button>
										<span>
											{repository.status === "missing" ? "Missing at startup" : "Available · changes unknown"}
										</span>
									</div>
								))}
							</nav>
						)}
					</div>
				)}
			</div>
		</aside>
	);
}
