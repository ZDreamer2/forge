import type { WorkspaceFileDiff } from "@forge/api-contract";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportUnexpectedError } from "../../../../../../../Lib/Report/Report";
import {
	ContextChangedError,
	hasOmittedContext,
	hydrateObservation,
	parseObservation,
	type TextObservation,
} from "./pierreAdapter";

export type ContextRequest = {
	pending: boolean;
	failed: boolean;
	blocked: boolean;
};

export type ContextPresentation =
	| { kind: "none" }
	| { kind: "changed" }
	| { kind: "load"; pending: boolean; disabled: boolean }
	| { kind: "retry"; reason: "size" | "request"; disabled: boolean };

type ContextModel =
	| { kind: "short" }
	| { kind: "complete"; model: FileDiffMetadata }
	| { kind: "changed" }
	| { kind: "refused" }
	| { kind: "failed"; error: unknown };

type ReadySession = {
	kind: "ready";
	short: FileDiffMetadata;
	completeObservation: WorkspaceFileDiff | undefined;
	context: ContextModel;
};
type FailedSession = {
	kind: "failed";
	error: unknown;
	fallback: "message" | "plain";
};
type Session = ReadySession | FailedSession;

type Presentation =
	| { kind: "failed"; fallback: "message" | "plain"; toggleFallback: () => void }
	| { kind: "ready"; model: FileDiffMetadata; context: ContextPresentation; onRenderError: (error: unknown) => void };

/** Mount per accepted short observation, using ChangeSetData's observation identity.
 * Query owns response freshness; this session owns mutable render models and recovery.
 */
export function useDiffPresentation({
	observation,
	complete,
	request,
}: {
	observation: TextObservation;
	complete: WorkspaceFileDiff | undefined;
	request: ContextRequest;
}): Presentation {
	const [session, setSession] = useState<Session>(() => {
		try {
			return {
				kind: "ready",
				short: parseObservation(observation),
				completeObservation: undefined,
				context: { kind: "short" },
			};
		} catch (error) {
			return { kind: "failed", error, fallback: "message" };
		}
	});
	// Accept an observation once, retaining its mutable model across unrelated renders.
	// Retirement drops hydration immediately; an incompatible short stays blocked until
	// the caller mounts a successful replacement observation, including after reload failure.
	const current = session.kind === "ready" ? acceptContext(session, observation, complete) : session;
	if (current !== session) setSession(current);

	const unexpected =
		current.kind === "failed" ? current : current.context.kind === "failed" ? current.context : undefined;
	const reported = useRef<{ error: unknown } | undefined>(undefined);
	useEffect(() => {
		if (unexpected && (!reported.current || reported.current.error !== unexpected.error)) {
			reported.current = { error: unexpected.error };
			reportUnexpectedError(unexpected.error);
		}
	}, [unexpected]);

	// memo-reason: DiffCanvas retains its renderer and expansion across unrelated
	// presentation updates; its error callback must not restart that lifecycle.
	const onRenderError = useCallback((error: unknown) => {
		setSession((previous) => (previous.kind === "failed" ? previous : { kind: "failed", error, fallback: "message" }));
	}, []);

	if (current.kind === "failed")
		return {
			kind: "failed",
			fallback: current.fallback,
			toggleFallback: () =>
				setSession((previous) =>
					previous.kind === "failed"
						? {
								...previous,
								fallback: previous.fallback === "message" ? "plain" : "message",
							}
						: previous,
				),
		};
	return {
		kind: "ready",
		model: current.context.kind === "complete" ? current.context.model : current.short,
		context: presentContext(current, request),
		onRenderError,
	};
}

function acceptContext(
	session: ReadySession,
	short: TextObservation,
	complete: WorkspaceFileDiff | undefined,
): ReadySession {
	if (session.completeObservation === complete) return session;
	let context: ContextModel;
	if (session.context.kind === "changed") context = session.context;
	else if (!complete) context = { kind: "short" };
	else if (complete.kind === "unsupported" && complete.reason === "too_large") context = { kind: "refused" };
	else {
		try {
			context = { kind: "complete", model: hydrateObservation(short, session.short, complete) };
		} catch (error) {
			context = error instanceof ContextChangedError ? { kind: "changed" } : { kind: "failed", error };
		}
	}
	return { ...session, completeObservation: complete, context };
}

function presentContext(session: ReadySession, request: ContextRequest): ContextPresentation {
	const disabled = request.pending || request.blocked;
	if (session.context.kind !== "changed" && request.failed) return { kind: "retry", reason: "request", disabled };
	switch (session.context.kind) {
		case "changed":
			return { kind: "changed" };
		case "refused":
			return { kind: "retry", reason: "size", disabled };
		case "failed":
			return { kind: "retry", reason: "request", disabled };
		case "complete":
			return { kind: "none" };
		case "short":
			return hasOmittedContext(session.short) ? { kind: "load", pending: request.pending, disabled } : { kind: "none" };
	}
}
