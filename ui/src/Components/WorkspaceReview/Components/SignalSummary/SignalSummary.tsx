import type { AnalysisSignal } from "@forge/api-contract";
import { Tooltip } from "@mantine/core";
import { useState } from "react";
import { type SignalAnalysis, signalMessages, signalSummary } from "../../Internal/signalAnalysis";
import styles from "./SignalSummary.module.css";

export function SignalSymbol({ severity }: { severity: AnalysisSignal["severity"] }) {
	return severity === "warning" ? (
		<svg className={styles.warning} width="14" height="14" viewBox="0 0 16 16" role="img" aria-label="Warning">
			<path d="M8 1.5 15 14H1Z" fill="currentColor" />
			<path d="M8 5v4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
			<circle cx="8" cy="11.5" r=".85" fill="white" />
		</svg>
	) : (
		<svg className={styles.notice} width="14" height="14" viewBox="0 0 16 16" role="img" aria-label="Notice">
			<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
			<path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<circle cx="8" cy="4.5" r=".85" fill="currentColor" />
		</svg>
	);
}

export function SignalSummary({
	signals,
	path,
	onInspect,
}: {
	signals: SignalAnalysis;
	path: string;
	onInspect: (path: string) => void;
}) {
	const [dismissed, setDismissed] = useState(false);
	const summary = signalSummary(signals, path);
	return (
		<span className={styles.summary}>
			{(["warning", "notice"] as const).map((severity) =>
				summary[severity].inclusive ? (
					<Tooltip
						key={severity}
						disabled={dismissed}
						interactive
						multiline
						events={{ hover: true, focus: true, touch: true }}
						classNames={{ tooltip: styles.tooltip }}
						label={<SignalMessages signals={signals} path={path} />}
					>
						<button
							type="button"
							className={`${styles.indicator} ${summary[severity].direct ? "" : styles.inherited}`}
							aria-label={`Inspect ${severity === "warning" ? "warnings" : "notices"} for ${path}`}
							onMouseEnter={() => {
								setDismissed(false);
							}}
							onFocus={() => {
								setDismissed(false);
							}}
							onClick={(event) => {
								event.stopPropagation();
								setDismissed(true);
								onInspect(path);
							}}
						>
							<SignalSymbol severity={severity} />
						</button>
					</Tooltip>
				) : null,
			)}
		</span>
	);
}

// Tooltip mounts its label only while open. Keep canonical list construction here
// so unhovered tree rows never copy their complete subtree messages.
function SignalMessages({ signals, path }: { signals: SignalAnalysis; path: string }) {
	return (
		<table className={styles.messages} aria-label={`Signals for ${path}`}>
			<tbody>
				{signalMessages(signals, path).map((message) => (
					<tr key={message.key}>
						<td>
							<SignalSymbol severity={message.severity} />
						</td>
						<td className={styles.path}>{message.displayPath}</td>
						<td>{message.message}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
