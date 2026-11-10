import type { AnalysisSide, ClassificationValue, WorkspaceAnalysis } from "@forge/api-contract";
import { Tooltip } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import {
	type Importance,
	importanceLabels,
	importanceOf,
	type MatrixCell,
	type ReviewAnalysis,
	resolveSelection,
	type Summary,
	typeLabels,
} from "../../Internal/changeAnalysis";
import type { WorkspaceGuidance } from "../../Internal/guidance";
import { consumePathRequest, type PathRequest, type PathRequestCursor } from "../../Internal/pathRequest";
import { type SignalAnalysis, signalMessages } from "../../Internal/signalAnalysis";
import { SignalSummary } from "../SignalSummary/SignalSummary";
import { FileDiff, FileDiffMode, FileDiffScope } from "./Components/FileDiff/FileDiff";
import { FolderContext } from "./Components/FolderContext/FolderContext";
import { PathHeader } from "./Components/PathHeader/PathHeader";
import { SignalDetails } from "./Components/SignalDetails/SignalDetails";
import styles from "./SelectionViewer.module.css";

export function SelectionViewer({
	review,
	selectedPath,
	codebases,
	guidance,
	onCopyPath,
	signals,
	inspectionRequest,
	onInspect,
	onSourceNavigate,
	onFolderNavigate,
	onReveal,
	onRefresh,
}: {
	review: ReviewAnalysis;
	signals?: SignalAnalysis | undefined;
	inspectionRequest?: PathRequest | undefined;
	onInspect?: ((path: string) => void) | undefined;
	onSourceNavigate?: ((path: string) => void) | undefined;
	onFolderNavigate?: ((path: string) => void) | undefined;
	onReveal?: ((path: string) => void) | undefined;
	selectedPath?: string | undefined;
	codebases?: WorkspaceAnalysis["codebases"] | undefined;
	guidance?: WorkspaceGuidance | undefined;
	onCopyPath?: ((path: string) => void) | undefined;
	onRefresh: () => void;
}) {
	const selected = resolveSelection(review, selectedPath);
	const messages = signals && selected ? signalMessages(signals, selected.path) : [];
	const [disclosure, setDisclosure] = useState({ path: selected?.path, open: false });
	if (disclosure.path !== selected?.path || (disclosure.open && !messages.length)) {
		setDisclosure({ path: selected?.path, open: false });
	}
	const open = disclosure.path === selected?.path && disclosure.open && messages.length > 0;
	const inspection = useRef<PathRequestCursor>({ pending: false });
	useEffect(() => {
		if (consumePathRequest(inspection.current, inspectionRequest, selectedPath, !!selected)) {
			setDisclosure({ path: selected?.path, open: messages.length > 0 });
		}
	}, [inspectionRequest, selectedPath, selected, messages.length]);
	function inspect(path: string) {
		if (onInspect) onInspect(path);
		else setDisclosure({ path, open: true });
	}
	const node = selected?.node;
	const path = selected?.path;
	const folder =
		selected &&
		(!node?.kind || node.children.length > 0 || node.base?.kind === "directory" || node.current?.kind === "directory");
	const filtered =
		selected &&
		((node?.kind && !selected.ownVisible) || (!node?.kind && selected.total.files > 0 && !selected.shown.files));
	return (
		<FileDiffScope>
			<section aria-label="Selection details" className={styles.details}>
				<header className={styles.header}>
					{path ? (
						<PathHeader key={path} path={path} onCopy={onCopyPath} />
					) : (
						<h2 className={styles.title}>Workspace changes</h2>
					)}
					{node?.kind && <FileDiffMode />}
				</header>
				{selected && messages.length > 0 && signals && (
					<div className={styles.signalSummary}>
						<SignalSummary signals={signals} path={selected.path} onInspect={inspect} />
						<button
							type="button"
							aria-expanded={open}
							onClick={() => setDisclosure({ path: selected.path, open: !open })}
						>
							{open ? "Hide signal details" : "Show signal details"}
						</button>
					</div>
				)}
				{open && (
					<SignalDetails messages={messages} review={review} onSourceNavigate={onSourceNavigate} onReveal={onReveal} />
				)}
				<div key={path ?? "orientation"} className={styles.content} data-testid="selection-scroll">
					{!selected ? (
						<div className={styles.orientation}>
							<strong>{review.all.files ? "Select a change" : "A clear workspace"}</strong>
							<p>
								{review.all.files
									? "Select a file or folder in the sidebar to read its changes."
									: "There are no changed entries in this workspace."}
							</p>
						</div>
					) : (
						<>
							{filtered && (
								<p className={styles.filtered} role="status">
									The selected change is outside the current filters. Its diff and metadata remain available.
								</p>
							)}
							{selected.repository && !folder && (
								<p className={styles.repository}>
									Repository {selected.repository.status === "missing" ? "· Missing at startup" : "· Available"}
								</p>
							)}
							{folder && (
								<section className={styles.subtree} aria-label="Matching subtree summary">
									<FolderContext selected={selected} guidance={guidance} onNavigate={onFolderNavigate} />
									{selected.shown.files ? (
										<>
											{!selected.shown.added && !selected.shown.removed && (
												<p>No line changes. Binary files and pure renames still count as changed files.</p>
											)}
											<FolderMatrix summary={selected.shown} totalFiles={selected.total.files} />
										</>
									) : (
										<>
											<h3>
												<MatrixTitle files={0} totalFiles={selected.total.files} />
											</h3>
											{selected.total.files > 0 && <p>No changes match the current filters.</p>}
										</>
									)}
								</section>
							)}
							{node?.kind && (
								<section aria-label="Selected entry metadata" className={styles.metadata}>
									<details>
										<summary>Entry metadata</summary>
										<h3>
											{node.kind.charAt(0).toUpperCase()}
											{node.kind.slice(1)} entry
										</h3>
										{node.from && (
											<p className={styles.rename}>
												Renamed from <code>{node.from}</code>
											</p>
										)}
										<dl>
											<div>
												<dt>Type</dt>
												<dd>
													{typeLabels[node.classification.value]}
													{node.classification.reason && <span>{node.classification.reason}</span>}
													{node.classification.handler && <span>Handler: {node.classification.handler}</span>}
												</dd>
											</div>
											<div>
												<dt>Importance</dt>
												<dd>
													{importanceLabels[importanceOf(node)]}
													{node.effectiveEmphasis.reason && <span>{node.effectiveEmphasis.reason}</span>}
													{node.effectiveEmphasis.handler && <span>Handler: {node.effectiveEmphasis.handler}</span>}
													{node.effectiveEmphasis.origin && <span>Origin: {node.effectiveEmphasis.origin}</span>}
												</dd>
											</div>
											{node.emphasis && (
												<div>
													<dt>Direct emphasis</dt>
													<dd>
														{node.emphasis.value}
														{node.emphasis.reason && <span>{node.emphasis.reason}</span>}
														<span>Handler: {node.emphasis.handler}</span>
													</dd>
												</div>
											)}
											{node.repo !== undefined && (
												<div>
													<dt>Change repository</dt>
													<dd>
														<code>{node.repo}</code>
													</dd>
												</div>
											)}
											{(["base", "current"] as const).map((side) => (
												<div key={side}>
													<dt>{side === "base" ? "Base" : "Current"} side</dt>
													<dd>
														<SideDetails side={node[side]} codebases={codebases} />
													</dd>
												</div>
											))}
										</dl>
										{node.statistics?.binary ? (
											<p>Binary change. Line totals are unavailable.</p>
										) : node.statistics ? (
											<p>
												Own change: {node.statistics.removed} removed lines, {node.statistics.added} added lines.
												{!node.statistics.added && !node.statistics.removed ? " No line changes were reported." : ""}
											</p>
										) : (
											<p>Line statistics are unavailable for this entry.</p>
										)}
										{node.renameContentChanged !== undefined && (
											<p>
												{node.renameContentChanged
													? "Rename includes a content change."
													: "Rename has no reported content change."}
											</p>
										)}
									</details>
								</section>
							)}
							{node?.kind && <FileDiff key={node.path} path={node.path} summary={node} onRefresh={onRefresh} />}
							{!node?.kind && !selected.total.files && (
								<p className={styles.quiet}>
									{selected.repository?.status === "missing"
										? "This repository was unavailable when the server started."
										: "No changed entries in this subtree."}
								</p>
							)}
						</>
					)}
				</div>
			</section>
		</FileDiffScope>
	);
}

function SideDetails({
	side,
	codebases,
}: {
	side?: AnalysisSide | undefined;
	codebases?: WorkspaceAnalysis["codebases"] | undefined;
}) {
	if (!side) return <>Absent</>;
	const owner =
		side.codebase !== undefined && Object.hasOwn(codebases ?? {}, side.codebase)
			? codebases?.[side.codebase]
			: undefined;
	return (
		<>
			{side.kind} · <code>{side.path}</code>
			{side.repository !== undefined && (
				<span>
					Repository: <code>{side.repository}</code>
				</span>
			)}
			{side.codebase !== undefined && (
				<span>
					Codebase: {owner?.id ?? side.codebase} (<code>{side.codebase}</code>)
				</span>
			)}
			{side.repositoryRoot !== undefined && (
				<span>
					Repository boundary: <code>{side.repositoryRoot}</code>
				</span>
			)}
			{side.codebaseRoot !== undefined && (
				<span>
					Codebase boundary: <code>{side.codebaseRoot}</code>
				</span>
			)}
		</>
	);
}

function MatrixTitle({ files, totalFiles }: { files: number; totalFiles: number }) {
	return (
		<>
			<Tooltip
				label="Files / added lines / removed lines"
				events={{ hover: true, focus: true, touch: true }}
				classNames={{ tooltip: styles.tooltip }}
			>
				{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Informational title tooltip must be keyboard accessible without implying a matrix action. */}
				<span tabIndex={0}>Type × importance</span>
			</Tooltip>
			{(files !== totalFiles || !files) && (
				<Tooltip
					label="Matching files out of all changed descendants, including nested repositories. Folder expansion does not affect these totals."
					events={{ hover: true, focus: true, touch: true }}
					classNames={{ tooltip: styles.tooltip }}
				>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Scope explanation must also be available on keyboard focus. */}
					<span tabIndex={0} className={styles.matrixScope}>
						{files} of {totalFiles} files
					</span>
				</Tooltip>
			)}
		</>
	);
}

function FolderMatrix({ summary, totalFiles }: { summary: Summary; totalFiles: number }) {
	const types = Object.keys(typeLabels) as ClassificationValue[];
	const importance = Object.keys(importanceLabels) as Importance[];
	function total(type?: ClassificationValue, level?: Importance): MatrixCell {
		const result = { files: 0, added: 0, removed: 0 };
		for (const row of type ? [type] : types)
			for (const column of level ? [level] : importance) {
				const cell = summary.matrix[row][column];
				result.files += cell.files;
				result.added += cell.added;
				result.removed += cell.removed;
			}
		return result;
	}
	const rows: { key?: ClassificationValue; label: string }[] = [
		{ label: "All" },
		...types.filter((type) => total(type).files).map((key) => ({ key, label: typeLabels[key] })),
	];
	const columns: { key?: Importance; label: string }[] = [
		{ label: "All" },
		...importance
			.filter((level) => total(undefined, level).files)
			.map((key) => ({ key, label: importanceLabels[key] })),
	];
	return (
		<div className={styles.matrixScroll}>
			<table className={styles.matrix} aria-label="Matching changes by type and importance">
				<caption>
					<MatrixTitle files={summary.files} totalFiles={totalFiles} />
				</caption>
				<thead>
					<tr>
						<th scope="col">Type / Importance</th>
						{columns.map((column) => (
							<th scope="col" key={column.label}>
								<span className={styles.matrixLabel}>{column.label}</span>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.label}>
							<th scope="row">
								<span className={styles.matrixLabel}>{row.label}</span>
							</th>
							{columns.map((column) => {
								const cell = total(row.key, column.key);
								return (
									<td key={column.label}>
										{cell.files ? (
											<span
												className={styles.matrixValues}
												role="img"
												aria-label={`${cell.files} files, ${cell.added} added lines, ${cell.removed} removed lines`}
											>
												<span>{cell.files}</span>
												<span className={styles.matrixSeparator}> / </span>
												<span className={styles.added}>+{cell.added}</span>
												<span className={styles.matrixSeparator}> / </span>
												<span className={styles.removed}>−{cell.removed}</span>
											</span>
										) : (
											<span role="img" className={styles.matrixEmpty} aria-label="No matching files">
												—
											</span>
										)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
