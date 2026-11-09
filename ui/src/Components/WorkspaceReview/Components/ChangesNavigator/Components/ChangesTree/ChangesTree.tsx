import type { AnalysisWireNode, WorkspaceAnalysis } from "@forge/api-contract";
import { Tooltip } from "@mantine/core";
import type { CSSProperties } from "react";
import type { Summary } from "../../../../Internal/changeAnalysis";
import type { SignalAnalysis } from "../../../../Internal/signalAnalysis";
import { ChangesSummary } from "../../../ChangesSummary/ChangesSummary";
import { SignalSummary } from "../../../SignalSummary/SignalSummary";
import type { ProjectedNode, TreeProjection } from "../../Internal/treeProjection";
import styles from "./ChangesTree.module.css";
import cssIcon from "./Internal/Assets/icons/css.svg";
import documentIcon from "./Internal/Assets/icons/document.svg";
import folderIcon from "./Internal/Assets/icons/folder-neutral.svg";
import imageIcon from "./Internal/Assets/icons/image.svg";
import markdownIcon from "./Internal/Assets/icons/markdown.svg";
import reactIcon from "./Internal/Assets/icons/react_ts.svg";
import testIcon from "./Internal/Assets/icons/test-ts.svg";
import typeScriptIcon from "./Internal/Assets/icons/typescript.svg";
import yamlIcon from "./Internal/Assets/icons/yaml.svg";

type Codebases = WorkspaceAnalysis["codebases"];

export function ChangesTree({
	projection,
	expansionVisibleSummary,
	workspaceName,
	signals,
	onInspect,
	expanded,
	selectedPath,
	onToggle,
	onSelect,
	onExpandAll,
	onCollapseAll,
	codebases,
}: {
	projection: TreeProjection;
	expansionVisibleSummary: Summary;
	workspaceName: string;
	signals?: SignalAnalysis | undefined;
	onInspect?: ((path: string) => void) | undefined;
	expanded: ReadonlySet<string>;
	selectedPath?: string | undefined;
	onToggle: (path: string) => void;
	onSelect: (path: string, copy: boolean) => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	codebases?: Codebases | undefined;
}) {
	function renderRow(entry: ProjectedNode, depth: number) {
		if (!entry.visible) return null;
		const { path, node } = entry;
		const folder =
			entry.children.length > 0 || !node?.kind || node.base?.kind === "directory" || node.current?.kind === "directory";
		const actualRepository =
			!!entry.repository || node?.base?.repositoryRoot !== undefined || node?.current?.repositoryRoot !== undefined;
		const isExpanded = expanded.has(path);
		const name = path === "." ? workspaceName : path.slice(path.lastIndexOf("/") + 1);
		const count = entry.shown;
		const boundaries = (["base", "current"] as const).flatMap((side) => {
			const facts = node?.[side];
			if (!facts) return [];
			return (["repository", "codebase"] as const).flatMap((kind) => {
				const root = facts[kind === "repository" ? "repositoryRoot" : "codebaseRoot"];
				if (root === undefined) return [];
				const owner = kind === "codebase" ? (codebases?.[root]?.id ?? root) : root;
				return [{ side, kind, root, owner }];
			});
		});
		return (
			<div key={path}>
				<div
					className={styles.row}
					data-path={path}
					data-kind={entry.kind}
					data-own-kind={node?.kind}
					data-importance={entry.importance}
					data-selected={selectedPath === path}
					style={{ "--depth": depth } as CSSProperties}
				>
					{entry.children.length > 0 ? (
						<button
							type="button"
							className={styles.disclosure}
							aria-label={`${isExpanded ? "Collapse" : "Expand"} ${path}`}
							aria-expanded={isExpanded}
							onClick={() => onToggle(path)}
						>
							{isExpanded ? "▾" : "▸"}
						</button>
					) : null}
					{folder ? (
						<span
							aria-hidden="true"
							className={styles.folderIcon}
							data-repository={actualRepository}
							style={{ maskImage: `url(${folderIcon})` }}
						/>
					) : (
						<img className={styles.fileIcon} src={fileIcon(node)} alt="" />
					)}
					<button
						type="button"
						className={styles.name}
						aria-label={`Select ${path}`}
						aria-pressed={selectedPath === path}
						onClick={(event) => onSelect(path, event.ctrlKey)}
					>
						{name}
						{node?.kind && folder && <span className={styles.ownChange}> · {node.kind}</span>}
					</button>
					{signals && onInspect && <SignalSummary signals={signals} path={path} onInspect={onInspect} />}
					{boundaries.map(({ side, kind, root, owner }) => (
						<Tooltip
							key={`${side}-${kind}`}
							events={{ hover: true, focus: true, touch: true }}
							classNames={{ tooltip: styles.tooltip }}
							label={`${side === "base" ? "Base" : "Current"} ${kind} root: ${owner} (${root})`}
						>
							<button type="button" className={styles.boundary} aria-label={`${side} ${kind} boundary: ${owner}`}>
								{kind === "repository" ? "r" : "c"}
							</button>
						</Tooltip>
					))}
					<ChangesSummary summary={count} label={`${path} visible subtree`} aggregate={folder} />
				</div>
				{isExpanded &&
					entry.children.map((child) => {
						const next = projection.nodes.get(child);
						return next ? renderRow(next, depth + 1) : null;
					})}
			</div>
		);
	}
	return (
		<div className={styles.scroll} data-testid="changes-scroll">
			<div className={styles.heading}>
				<div className={styles.headingText}>
					<div className={styles.actions}>
						<button type="button" aria-label="Collapse all" onClick={onCollapseAll}>
							⊟
						</button>
						<button type="button" aria-label="Expand all" onClick={onExpandAll}>
							⊞
						</button>
					</div>
					<h2>
						Changes{" "}
						<span>
							{projection.visible.files} of {projection.all.files}
						</span>
					</h2>
				</div>
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
					<ChangesSummary summary={expansionVisibleSummary} label="Shown changes" />
				</div>
			</div>
			<nav aria-label="Changed files">
				{projection.root?.visible ? (
					renderRow(projection.root, 0)
				) : (
					<p className={styles.emptyTree}>{projection.all.files ? "No changes match the filters" : "No changes"}</p>
				)}
			</nav>
		</div>
	);
}

function fileIcon(node: AnalysisWireNode | undefined) {
	if (!node) return documentIcon;
	if (node.path.endsWith(".tsx") || node.path.endsWith(".jsx")) return reactIcon;
	if (node.path.endsWith(".css")) return cssIcon;
	if (node.path.endsWith(".md")) return markdownIcon;
	if (node.path.endsWith(".yaml") || node.path.endsWith(".yml")) return yamlIcon;
	if (node.classification.value === "tests") return testIcon;
	if (node.classification.value === "assets") return imageIcon;
	if (node.path.endsWith(".ts")) return typeScriptIcon;
	return documentIcon;
}
