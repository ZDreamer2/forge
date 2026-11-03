import { Tooltip } from "@mantine/core";
import { importanceLabels, type Summary, typeLabels } from "../../Internal/changeAnalysis";
import styles from "./ChangesSummary.module.css";

export function ChangesSummary({
	summary,
	label,
	files = false,
}: {
	summary: Summary;
	label: string;
	files?: boolean;
}) {
	const groups = [
		{
			title: "Type",
			rows: Object.entries(summary.types).map(([key, value]) => ({
				label: typeLabels[key as keyof typeof typeLabels],
				...value,
			})),
		},
		{
			title: "Importance",
			rows: Object.entries(summary.importance).map(([key, value]) => ({
				label: importanceLabels[key as keyof typeof importanceLabels],
				...value,
			})),
		},
	];
	return (
		<span className={styles.summary}>
			{files && (
				<span className={styles.files}>
					<strong>{summary.files}</strong> files
				</span>
			)}
			<Tooltip
				multiline
				events={{ hover: true, focus: true, touch: true }}
				classNames={{ tooltip: styles.tooltip }}
				label={
					<div className={styles.breakdowns}>
						{groups.map((group) => (
							<table key={group.title}>
								<caption>{group.title}</caption>
								<tbody>
									{group.rows
										.filter((row) => row.added || row.removed)
										.map((row) => (
											<tr key={row.label}>
												<th scope="row">{row.label}</th>
												<td className={styles.removed}>{row.removed ? `−${row.removed}` : ""}</td>
												<td className={styles.added}>{row.added ? `+${row.added}` : ""}</td>
											</tr>
										))}
								</tbody>
							</table>
						))}
						{!summary.added && !summary.removed && <p>No line changes.</p>}
					</div>
				}
			>
				<button
					type="button"
					className={styles.counts}
					aria-label={`${label}: ${summary.files} changed files, ${summary.removed} removed lines, ${summary.added} added lines`}
				>
					<span className={styles.removed}>{summary.removed ? `−${summary.removed}` : ""}</span>
					<span className={styles.added}>{summary.added ? `+${summary.added}` : ""}</span>
				</button>
			</Tooltip>
		</span>
	);
}
