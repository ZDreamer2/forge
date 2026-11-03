import type { AnalysisSide, WorkspaceAnalysis } from "@forge/api-contract";
import { Tooltip } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import {
	importanceLabels,
	importanceOf,
	type ReviewAnalysis,
	resolveSelection,
	typeLabels,
} from "../../Internal/changeAnalysis";
import { consumePathRequest, type PathRequest, type PathRequestCursor } from "../../Internal/pathRequest";
import { type SignalAnalysis, signalMessages } from "../../Internal/signalAnalysis";
import { ChangesSummary } from "../ChangesSummary/ChangesSummary";
import { SignalSummary } from "../SignalSummary/SignalSummary";
import { FileDiff, FileDiffMode, FileDiffScope } from "./Components/FileDiff/FileDiff";
import { SignalDetails } from "./Components/SignalDetails/SignalDetails";
import styles from "./SelectionViewer.module.css";

export function SelectionViewer({
	review,
	selectedPath,
	codebases,
	signals,
	inspectionRequest,
	onInspect,
	onSourceNavigate,
	onReveal,
	onRefresh,
}: {
	review: ReviewAnalysis;
	signals?: SignalAnalysis | undefined;
	inspectionRequest?: PathRequest | undefined;
	onInspect?: ((path: string) => void) | undefined;
	onSourceNavigate?: ((path: string) => void) | undefined;
	onReveal?: ((path: string) => void) | undefined;
	selectedPath?: string | undefined;
	codebases?: WorkspaceAnalysis["codebases"] | undefined;
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
	const fragments = path?.split("/") ?? [];
	const filename = fragments.pop();
	const first = fragments.length > 1 ? `${fragments.shift()}/` : "";
	const parent = fragments.length > 0 ? `${fragments.pop()}/` : "";
	const middle = fragments.length > 0 ? `${fragments.join("/")}/` : "";
	const filtered =
		selected &&
		((node?.kind && !selected.ownVisible) || (!node?.kind && selected.total.files > 0 && !selected.shown.files));
	return (
		<FileDiffScope>
			<section aria-label="Selection details" className={styles.details}>
				<header className={styles.header}>
					{path ? (
						<h2 className={styles.title} aria-label={path}>
							<Tooltip
								label={path}
								multiline
								events={{ hover: true, focus: true, touch: true }}
								classNames={{ tooltip: styles.tooltip }}
							>
								<button type="button" className={styles.path} aria-label={`Full path: ${path}`}>
									<span className={styles.first}>{first}</span>
									<span className={styles.middle}>{middle}</span>
									<span className={styles.parent}>{parent}</span>
									<strong>{filename}</strong>
								</button>
							</Tooltip>
						</h2>
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
							{selected.repository && (
								<p className={styles.repository}>
									Repository {selected.repository.status === "missing" ? "· Missing at startup" : "· Available"}
								</p>
							)}
							{(!node?.kind ||
								(node?.children.length ?? 0) > 0 ||
								node.base?.kind === "directory" ||
								node.current?.kind === "directory") && (
								<section className={styles.subtree} aria-label="Visible subtree summary">
									<h3>
										{selected.shown.files} visible changed files <span>of {selected.total.files} in this subtree</span>
									</h3>
									<ChangesSummary summary={selected.shown} label={`${path} visible subtree`} />
									<p>Subtree counts follow the current filters and include nested repositories.</p>
									{selected.repositoryShown && selected.repositoryTotal && (
										<p>
											Repository-owned changes: {selected.repositoryShown.files} of {selected.repositoryTotal.files}.
											Nested repositories are counted separately.
										</p>
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
