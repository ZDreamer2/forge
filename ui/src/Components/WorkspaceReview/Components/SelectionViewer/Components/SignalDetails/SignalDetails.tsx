import type { ReviewAnalysis } from "../../../../Internal/changeAnalysis";
import type { SignalMessage } from "../../../../Internal/signalAnalysis";
import { SignalSymbol } from "../../../SignalSummary/SignalSummary";
import styles from "./SignalDetails.module.css";

export function SignalDetails({
	messages,
	review,
	onSourceNavigate,
	onReveal,
}: {
	messages: readonly SignalMessage[];
	review: ReviewAnalysis;
	onSourceNavigate?: ((path: string) => void) | undefined;
	onReveal?: ((path: string) => void) | undefined;
}) {
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll this bounded message region.
		<section aria-label="Signal details" className={styles.details} tabIndex={0}>
			<table className={styles.messages}>
				<tbody>
					{messages.map((message) => {
						const source = review.subjects.get(message.sourcePath);
						const filtered = !!source?.node?.kind && !source.ownVisible;
						return (
							<tr key={message.key}>
								<td className={styles.symbol}>
									<SignalSymbol severity={message.severity} />
								</td>
								<td className={styles.source}>
									<button
										type="button"
										aria-label={`Inspect source ${message.sourcePath}`}
										onClick={() => onSourceNavigate?.(message.sourcePath)}
									>
										{message.displayPath}
									</button>
									{filtered && <span className={styles.filtered}>Filtered out</span>}
									{filtered && onReveal && (
										<button
											type="button"
											className={styles.reveal}
											aria-label={`Reveal file ${message.sourcePath}`}
											onClick={() => onReveal(message.sourcePath)}
										>
											Reveal file
										</button>
									)}
								</td>
								<td>
									<div>{message.message}</div>
									<div className={styles.attribution}>
										Handler: {message.handler}
										{message.location && (
											<span>
												{" "}
												· {message.location.side === "base" ? "Base" : "Current"} line {message.location.line}
												{message.location.column !== undefined ? `, column ${message.location.column}` : ""}
											</span>
										)}
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</section>
	);
}
