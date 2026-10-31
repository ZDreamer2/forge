import { Button, Paper, Title } from "@mantine/core";
import { useWorkspaceOverview } from "../../Lib/WorkspaceData/WorkspaceData";
import styles from "./WorkspaceOverview.module.css";

export function WorkspaceOverview() {
	const { workspace, analysis, updating, refresh } = useWorkspaceOverview();
	const changedEntries = analysis.data
		? Object.values(analysis.data.nodes).filter((node) => node.kind !== undefined).length
		: undefined;
	const totals = analysis.data?.nodes[analysis.data.root];

	return (
		<main className={styles.overview}>
			<header className={styles.header}>
				<div>
					<p className={styles.brand}>FORGE</p>
					<Title order={1}>Workspace overview</Title>
				</div>
				<Button disabled={updating} onClick={() => void refresh()}>
					Refresh
				</Button>
			</header>
			{updating && <p role="status">{workspace.data || analysis.data ? "Updating…" : "Loading workspace…"}</p>}
			<Paper component="section" aria-label="Workspace identity" withBorder p="lg" radius="md">
				<Title order={2}>Workspace</Title>
				{workspace.isError && (
					<p role="alert">{workspace.data ? "Workspace identity is stale. " : ""}Could not load workspace identity.</p>
				)}
				{workspace.data && (
					<>
						<h3 className={styles.name}>{workspace.data.workspace.name}</h3>
						<p className={styles.path}>{workspace.data.workspace.root}</p>
						<ul>
							{workspace.data.repositories.map((repository) => (
								<li key={repository.path} className={styles.path}>
									{repository.path}: {repository.status === "available" ? "Available" : "Missing"}
								</li>
							))}
						</ul>
					</>
				)}
				{workspace.isError && (
					<Button variant="light" disabled={workspace.isFetching} onClick={() => void workspace.refetch()}>
						Retry workspace
					</Button>
				)}
			</Paper>
			<Paper component="section" aria-label="Change summary" withBorder p="lg" radius="md">
				<Title order={2}>Changes</Title>
				{analysis.isError && (
					<p role="alert">{analysis.data ? "Change summary is stale. " : ""}Could not load change summary.</p>
				)}
				{totals && (
					<>
						<dl className={styles.totals}>
							<div>
								<dt>Changed entries</dt>
								<dd>{changedEntries}</dd>
							</div>
							<div>
								<dt>All-change additions</dt>
								<dd>{totals.rawTotals.added}</dd>
							</div>
							<div>
								<dt>All-change removals</dt>
								<dd>{totals.rawTotals.removed}</dd>
							</div>
							<div>
								<dt>Attention additions</dt>
								<dd>{totals.attentionTotals.added}</dd>
							</div>
							<div>
								<dt>Attention removals</dt>
								<dd>{totals.attentionTotals.removed}</dd>
							</div>
						</dl>
						{changedEntries === 0 && <p>No changed entries.</p>}
					</>
				)}
				{analysis.isError && (
					<Button variant="light" disabled={analysis.isFetching} onClick={() => void analysis.refetch()}>
						Retry changes
					</Button>
				)}
			</Paper>
		</main>
	);
}
