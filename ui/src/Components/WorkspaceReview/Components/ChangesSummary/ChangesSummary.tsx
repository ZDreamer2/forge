import type { Summary } from "../../Internal/changeAnalysis";
import styles from "./ChangesSummary.module.css";

export function ChangesSummary({
	summary,
	label,
	files = false,
	aggregate = false,
}: {
	summary: Summary;
	label: string;
	files?: boolean;
	aggregate?: boolean;
}) {
	return (
		<span className={`${styles.summary} ${aggregate ? styles.aggregate : ""}`}>
			{files && (
				<span className={styles.files}>
					<strong>{summary.files}</strong> files
				</span>
			)}
			<span
				role="img"
				className={styles.counts}
				aria-label={`${label}: ${summary.files} changed files, ${summary.removed} removed lines, ${summary.added} added lines`}
			>
				<span className={styles.removed}>{summary.removed ? `−${summary.removed}` : ""}</span>
				<span className={styles.added}>{summary.added ? `+${summary.added}` : ""}</span>
			</span>
		</span>
	);
}
