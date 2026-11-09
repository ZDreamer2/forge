import type { WorkspaceAnalysis, WorkspaceIdentity } from "@forge/api-contract";
import { useMemo } from "react";
import type { Filters, ReviewAnalysis } from "../../Internal/changeAnalysis";
import type { PathRequest } from "../../Internal/pathRequest";
import type { SignalAnalysis } from "../../Internal/signalAnalysis";
import styles from "./ChangesNavigator.module.css";
import { ChangeFilters } from "./Components/ChangeFilters/ChangeFilters";
import { ChangesTree } from "./Components/ChangesTree/ChangesTree";
import { projectTree } from "./Internal/treeProjection";
import { useExpansion } from "./Internal/useExpansion";

type Props = {
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
}: Props) {
	// memo-reason: hierarchy/style projection traverses the complete canonical tree;
	// divider and clipboard updates in the composing review do not change its inputs.
	const projection = useMemo(() => projectTree(review), [review]);
	const expansion = useExpansion(projection, selectedPath, revealRequest);
	return (
		<aside className={styles.sidebar} aria-label="Changes navigator">
			<ChangeFilters filters={filters} onChange={onFiltersChange} />
			<div className={styles.treeScroll}>
				{analysis ? (
					<ChangesTree
						projection={projection}
						workspaceName={identity?.workspace.name ?? "."}
						signals={signals}
						onInspect={onInspect}
						expanded={expansion.expanded}
						selectedPath={selectedPath}
						codebases={analysis.codebases}
						onSelect={onSelect}
						onToggle={expansion.toggle}
						onExpandAll={expansion.expandAll}
						onCollapseAll={expansion.collapseAll}
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
