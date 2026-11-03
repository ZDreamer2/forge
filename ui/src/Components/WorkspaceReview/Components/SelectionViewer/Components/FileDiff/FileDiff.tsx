import type { AnalysisWireNode, WorkspaceFileDiff } from "@forge/api-contract";
import { Button } from "@mantine/core";
import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { createContext, type ReactElement, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useSelectedFile } from "../../../../Lib/ChangeSetData/ChangeSetData";
import styles from "./FileDiff.module.css";
import type { TextObservation } from "./Internal/pierreAdapter";
import { createRenderer, prepareHighlight } from "./Internal/pierreRenderer";
import { type ContextPresentation, type ContextRequest, useDiffPresentation } from "./Internal/useDiffPresentation";

type Mode = "unified" | "split";
const ModeContext = createContext<{ mode: Mode; setMode: (mode: Mode) => void }>({
	mode: "unified",
	setMode: () => {},
});

/** Mount once for a review; selection and observations reset the diff, not its mode. */
export function FileDiffScope({ children }: { children: ReactNode }) {
	const [mode, setMode] = useState<Mode>("unified");
	return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function FileDiffMode() {
	const { mode, setMode } = useContext(ModeContext);
	return (
		<fieldset className={styles.mode} aria-label="Diff view">
			{(["unified", "split"] as const).map((value) => (
				<button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>
					{value === "unified" ? "Unified" : "Split"}
				</button>
			))}
		</fieldset>
	);
}

export function FileDiff({
	path,
	summary,
	onRefresh,
}: {
	path: string;
	summary: AnalysisWireNode;
	onRefresh: () => void;
}) {
	const data = useSelectedFile(path);
	const { file, complete } = data;
	return (
		<section aria-label="File diff" className={styles.diff}>
			{file.isFetching && <p role="status">{file.data ? "Updating file…" : "Loading file…"}</p>}
			{file.isError && (
				<div role="alert">
					{file.data ? "File diff is stale. " : ""}Could not load file.{" "}
					<Button size="compact-xs" variant="subtle" onClick={() => void data.reload()} disabled={file.isFetching}>
						Retry file
					</Button>
				</div>
			)}
			{file.data && (
				<>
					<ObservationFacts observation={file.data} summary={summary} onRefresh={onRefresh} />
					{file.data.kind === "text" ? (
						<TextDiff
							key={data.observation}
							observation={file.data}
							complete={complete.data}
							contextRequest={{
								failed: complete.isError,
								pending: complete.isFetching,
								blocked: !file.isSuccess || file.isFetching,
							}}
							loadComplete={() => void data.loadComplete()}
							reload={() => void data.reload()}
						/>
					) : (
						<p>{explanation(file.data)}</p>
					)}
				</>
			)}
		</section>
	);
}

function explanation(observation: WorkspaceFileDiff) {
	if (observation.kind === "not_changed") return "This entry is no longer changed. Refresh the change summary.";
	if (observation.kind === "metadata_only")
		return "Metadata-only change. There are no text hunks (empty sides, rename or mode change).";
	if (observation.kind === "unsupported") {
		if (observation.reason === "binary") return "Binary file. A text diff is unavailable.";
		if (observation.reason === "encoding") return "This patch uses an unsupported text encoding.";
		return `This patch exceeds the text size limit${observation.limitBytes ? ` (${observation.limitBytes} bytes)` : ""}.`;
	}
	return "";
}

function ObservationFacts({
	observation,
	summary,
	onRefresh,
}: {
	observation: WorkspaceFileDiff;
	summary: AnalysisWireNode;
	onRefresh: () => void;
}) {
	if (observation.kind === "not_changed") return null;
	const differs =
		observation.changeKind !== summary.kind ||
		observation.from !== summary.from ||
		(summary.statistics !== undefined &&
			(observation.statistics.added !== summary.statistics.added ||
				observation.statistics.removed !== summary.statistics.removed ||
				observation.statistics.binary !== summary.statistics.binary)) ||
		(["base", "current"] as const).some((side) => {
			const fact = observation[side];
			const old = summary[side];
			return (
				(fact.present || fact.kind === "directory") !== !!old ||
				(!!old && (fact.path !== old.path || fact.kind !== old.kind || fact.codebase !== old.codebase))
			);
		});
	return (
		<>
			{differs && (
				<p className={styles.notice}>
					The analysis summary describes an older observation.{" "}
					<button type="button" onClick={onRefresh}>
						Refresh summary
					</button>
				</p>
			)}
			<details className={styles.facts}>
				<summary>File observation</summary>
				<p>
					{observation.changeKind}
					{observation.from ? ` · Renamed from ${observation.from}` : ""} · Repository {observation.repo}
				</p>
				<dl>
					{(["base", "current"] as const).map((side) => {
						const fact = observation[side];
						return (
							<div key={side}>
								<dt>{side === "base" ? "Base" : "Current"}</dt>
								<dd>
									{fact.present ? fact.kind : fact.kind === "directory" ? "directory (no file payload)" : "Absent"} ·{" "}
									<code>{fact.path}</code> · mode {fact.mode}
									{fact.codebase !== undefined
										? ` · Codebase ${observation.codebases[fact.codebase]?.id ?? fact.codebase}`
										: ""}
								</dd>
							</div>
						);
					})}
				</dl>
				<p>
					Baseline: {observation.baseline.kind === "commit" ? observation.baseline.oid : "unborn"}. File responses are
					live observations.
				</p>
			</details>
		</>
	);
}

function TextDiff({
	observation,
	complete,
	contextRequest,
	loadComplete,
	reload,
}: {
	observation: TextObservation;
	complete: WorkspaceFileDiff | undefined;
	contextRequest: ContextRequest;
	loadComplete: () => void;
	reload: () => void;
}) {
	const presentation = useDiffPresentation({ observation, complete, request: contextRequest });
	const { mode } = useContext(ModeContext);
	if (presentation.kind === "failed")
		return (
			<>
				<div role="alert">
					The diff could not be rendered.{" "}
					<Button size="compact-xs" variant="subtle" onClick={reload}>
						Reload file
					</Button>
					<Button size="compact-xs" variant="subtle" onClick={presentation.toggleFallback}>
						{presentation.fallback === "plain" ? "Hide plain patch" : "Show plain patch"}
					</Button>
				</div>
				{presentation.fallback === "plain" && (
					<section aria-label="Plain text patch">
						<pre className={styles.plainPatch}>{observation.patch}</pre>
					</section>
				)}
			</>
		);
	return (
		<>
			<ContextControls context={presentation.context} loadComplete={loadComplete} reload={reload} />
			<DiffCanvas model={presentation.model} mode={mode} onError={presentation.onRenderError} />
		</>
	);
}

function ContextControls({
	context,
	loadComplete,
	reload,
}: {
	context: ContextPresentation;
	loadComplete: () => void;
	reload: () => void;
}): ReactElement | null {
	switch (context.kind) {
		case "none":
			return null;
		case "changed":
			return (
				<p role="alert">
					The file changed since this short diff. This is an older observation.{" "}
					<Button size="compact-xs" variant="subtle" onClick={reload}>
						Reload file
					</Button>
				</p>
			);
		case "retry":
			return (
				<p role="alert">
					{context.reason === "size"
						? "Complete context exceeds the text size limit."
						: "Could not load omitted context."}{" "}
					The short diff remains available.{" "}
					<Button size="compact-xs" variant="subtle" disabled={context.disabled} onClick={loadComplete}>
						Retry context
					</Button>
				</p>
			);
		case "load":
			return (
				<Button
					className={styles.context}
					variant="subtle"
					size="compact-xs"
					disabled={context.disabled}
					onClick={loadComplete}
				>
					{context.pending ? "Loading omitted context…" : "Load omitted context"}
				</Button>
			);
	}
}

const renderOptions: FileDiffOptions<undefined, undefined> = {
	disableErrorHandling: true,
	theme: "github-light",
	themeType: "light",
	preferredHighlighter: "shiki-js",
	disableFileHeader: true,
	hunkSeparators: "line-info-basic",
	overflow: "scroll",
	tokenizeMaxLineLength: 1000,
	tokenizeMaxLength: 100000,
	lineDiffType: "none",
	unsafeCSS:
		':host { --diffs-font-family: "JetBrains Mono", Consolas, monospace; --diffs-font-size: 12px; --diffs-line-height: 20px; color-scheme: light; }',
};

function DiffCanvas({
	model,
	mode,
	onError,
}: {
	model: FileDiffMetadata;
	mode: Mode;
	onError: (error: unknown) => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	const instance = useRef<ReturnType<typeof createRenderer> | undefined>(undefined);
	const currentMode = useRef(mode);
	useEffect(() => {
		currentMode.current = mode;
		instance.current?.setOptions({ ...renderOptions, diffStyle: mode });
		instance.current?.rerender();
	}, [mode]);
	useEffect(() => {
		let active = true;
		let renderer: ReturnType<typeof createRenderer> | undefined;
		const fail = (error: unknown) => {
			if (active) onError(error);
		};

		void prepareHighlight(model.name)
			.then(() => {
				if (!active || !host.current) return;
				renderer = createRenderer({ ...renderOptions, diffStyle: currentMode.current }, fail);
				instance.current = renderer;
				renderer.render({ fileDiff: model, containerWrapper: host.current });
			})
			.catch(fail);
		return () => {
			active = false;
			renderer?.cleanUp();
			if (instance.current === renderer) instance.current = undefined;
		};
	}, [model, onError]);
	return <div className={styles.canvas} ref={host} />;
}
