import type { AnnotationContribution } from "../../tree-analysis/index.ts";
import type { GuideIdentity } from "../../workspace-config/index.ts";

export interface LoadedGuideExtension extends AnnotationContribution {
	readonly error?: GuideExtensionLoadError;
}

export class GuideExtensionLoadError extends Error {
	readonly guide: GuideIdentity;
	#privateCause: unknown;
	constructor(guide: GuideIdentity, cause: unknown) {
		super(`Guide extension failed to load: ${guide}`);
		this.guide = guide;
		this.#privateCause = cause;
	}

	diagnostic(): string {
		return this.#privateCause instanceof Error ? this.#privateCause.message : "Extension threw a non-Error value";
	}
}
