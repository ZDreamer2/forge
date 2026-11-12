import type { ClassificationValue } from "@forge/api-contract";
import { Tooltip } from "@mantine/core";
import { type Filters, type Importance, importanceLabels, typeLabels } from "../../../../Internal/changeAnalysis";
import styles from "./ChangeFilters.module.css";

export function ChangeFilters({
	filters,
	onChange,
	showFolderCounters,
	onToggleFolderCounters,
}: {
	filters: Filters;
	onChange: (filters: Filters) => void;
	showFolderCounters: boolean;
	onToggleFolderCounters: () => void;
}) {
	function toggleType(value: ClassificationValue) {
		const types = new Set(filters.types);
		if (!types.delete(value)) types.add(value);
		onChange({ ...filters, types });
	}
	function toggleImportance(value: Importance) {
		const importance = new Set(filters.importance);
		if (!importance.delete(value)) importance.add(value);
		onChange({ ...filters, importance });
	}
	function selectAll(selected: boolean) {
		onChange({
			types: new Set(selected ? (Object.keys(typeLabels) as ClassificationValue[]) : []),
			importance: new Set(selected ? (Object.keys(importanceLabels) as Importance[]) : []),
		});
	}
	return (
		<section className={styles.filters} aria-label="Change filters">
			<div className={styles.options}>
				<fieldset>
					<legend>Type</legend>
					{(Object.keys(typeLabels) as ClassificationValue[]).map((value) => (
						<button
							key={value}
							type="button"
							className={styles.toggle}
							aria-pressed={filters.types.has(value)}
							onClick={() => toggleType(value)}
						>
							{typeLabels[value]}
						</button>
					))}
				</fieldset>
				<fieldset>
					<legend>Importance</legend>
					{(Object.keys(importanceLabels) as Importance[]).map((value) => (
						<button
							key={value}
							type="button"
							className={styles.toggle}
							aria-pressed={filters.importance.has(value)}
							onClick={() => toggleImportance(value)}
						>
							{importanceLabels[value]}
						</button>
					))}
				</fieldset>
			</div>
			<div className={styles.actions}>
				<Tooltip label="Select all types and importance levels" events={{ hover: true, focus: true, touch: true }}>
					<button
						className={styles.action}
						type="button"
						aria-label="Select all types and importance levels"
						onClick={() => selectAll(true)}
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<rect x="3" y="3" width="14" height="14" rx="2" />
							<path d="m6 10 3 3 5-6" />
						</svg>
					</button>
				</Tooltip>
				<Tooltip label="Deselect all types and importance levels" events={{ hover: true, focus: true, touch: true }}>
					<button
						className={styles.action}
						type="button"
						aria-label="Deselect all types and importance levels"
						onClick={() => selectAll(false)}
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<rect x="3" y="3" width="14" height="14" rx="2" />
							<path d="m7 7 6 6m0-6-6 6" />
						</svg>
					</button>
				</Tooltip>
				<Tooltip
					label="Show folder counters (file and repository counters always visible)"
					events={{ hover: true, focus: true, touch: true }}
				>
					<button
						type="button"
						className={`${styles.action} ${styles.folderCounters}`}
						aria-label="Show folder counters"
						aria-pressed={showFolderCounters}
						onClick={onToggleFolderCounters}
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path d="M2 6V4h6l2 2h8v10H2zM5 9h3m-1.5-1.5v3M11 9h4M5 13h3m3 0h4" />
						</svg>
					</button>
				</Tooltip>
			</div>
		</section>
	);
}
