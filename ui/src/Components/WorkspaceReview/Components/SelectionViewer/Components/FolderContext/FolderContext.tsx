import { Tooltip } from "@mantine/core";
import type { ReviewSubject } from "../../../../Internal/changeAnalysis";
import { type GuidanceEntry, isWorkspaceGuidanceRoot, type WorkspaceGuidance } from "../../../../Internal/guidance";
import styles from "./FolderContext.module.css";

const sources = {
	"workspace-parent": "Workspace parent",
	workspace: "Workspace",
	"project-parent": "Project parent",
	"project-folder": "Project folder",
};

export function FolderContext({
	selected,
	guidance,
	onNavigate,
}: {
	selected: ReviewSubject;
	guidance?: WorkspaceGuidance | undefined;
	onNavigate?: ((path: string) => void) | undefined;
}) {
	function rootLink(root: string | undefined) {
		return root === undefined ? (
			"—"
		) : !isWorkspaceGuidanceRoot(root) ? (
			<code>{root}</code>
		) : (
			<button type="button" className={styles.root} onClick={() => onNavigate?.(root)}>
				{root === "." ? "Workspace" : root}
			</button>
		);
	}
	function table(entries: GuidanceEntry[] | undefined) {
		if (!entries) return <p>Guidance context is unavailable.</p>;
		return (
			<div className={styles.scroll}>
				<table className={styles.guidance} aria-label="Forge guidance">
					<caption>
						Forge guidance{" "}
						<Tooltip
							label="Application order: parents before consumers, shared guides once. Folder ancestry alone does not imply inherited guidance."
							events={{ hover: true, focus: true, touch: true }}
							classNames={{ tooltip: styles.tooltip }}
						>
							<button type="button" className={styles.help} aria-label="About Forge guidance order">
								ⓘ
							</button>
						</Tooltip>
					</caption>
					<thead>
						<tr>
							<th scope="col">Guide / scope</th>
							<th scope="col">Source</th>
							<th scope="col">Root</th>
						</tr>
					</thead>
					<tbody>
						{entries.map((entry) => (
							<tr key={entry.id} data-workspace={entry.source === "workspace"}>
								<th scope="row">
									<Tooltip
										label={
											<>
												Guide: <code>{entry.guidance}</code>
											</>
										}
										events={{ hover: true, focus: true, touch: true }}
										classNames={{ tooltip: styles.tooltip }}
									>
										{/* biome-ignore lint/a11y/noNoninteractiveTabindex: Guide-directory information must also be available on keyboard focus. */}
										<span tabIndex={0} className={styles.name}>
											{entry.name}
										</span>
									</Tooltip>
								</th>
								<td>{sources[entry.source]}</td>
								<td>{rootLink(entry.root)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}
	function context(repository: string | undefined, codebase: string | undefined) {
		return (
			<>
				<p className={styles.repository}>
					Repository: {rootLink(repository)}
					{selected.repository && selected.repository.path === repository && (
						<span> · {selected.repository.status === "missing" ? "Missing at startup" : "Available"}</span>
					)}
				</p>
				{table(
					codebase === undefined
						? guidance?.workspace
						: Object.hasOwn(guidance?.codebases ?? {}, codebase)
							? guidance?.codebases[codebase]
							: undefined,
				)}
			</>
		);
	}
	const base = selected.node?.base;
	const current = selected.node?.current;
	const same = base && current && base.repository === current.repository && base.codebase === current.codebase;
	return (
		<section className={styles.context} aria-label="Folder context">
			<h3>Context</h3>
			{same ? (
				context(current.repository, current.codebase)
			) : base || current ? (
				<>
					{base && (
						<section aria-label="Base context">
							<h4>Base{base.kind !== "directory" ? ` · ${base.kind}` : ""}</h4>
							{context(base.repository, base.codebase)}
						</section>
					)}
					{current && (
						<section aria-label="Current context">
							<h4>Current{current.kind !== "directory" ? ` · ${current.kind}` : ""}</h4>
							{context(current.repository, current.codebase)}
						</section>
					)}
				</>
			) : (
				<>
					{context(
						selected.repository?.path,
						Object.hasOwn(guidance?.codebases ?? {}, selected.path) ? selected.path : undefined,
					)}
					{selected.path !== "." && (
						<p>
							Side ownership is unavailable
							{Object.hasOwn(guidance?.codebases ?? {}, selected.path)
								? ". Guidance is shown for this registered root."
								: "; only workspace guidance is shown."}
						</p>
					)}
				</>
			)}
		</section>
	);
}
