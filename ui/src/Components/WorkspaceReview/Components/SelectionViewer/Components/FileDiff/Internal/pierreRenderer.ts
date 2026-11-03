import {
	type FileDiffOptions,
	type FileDiffRenderProps,
	getFiletypeFromFileName,
	getSharedHighlighter,
	FileDiff as PierreFileDiff,
} from "@pierre/diffs";

// The React wrapper does not expose the released renderer's asynchronous error
// callback. Keep that callback and queued render failures inside this file view.
class ContainedDiff extends PierreFileDiff {
	private readonly fail: (error: unknown) => void;
	constructor(options: FileDiffOptions<undefined, undefined>, fail: (error: unknown) => void) {
		super({ ...options, disableErrorHandling: true });
		this.fail = fail;
		this.hunksRenderer.onHighlightError = fail;
	}
	override render(input: FileDiffRenderProps<undefined>): boolean {
		try {
			return super.render(input);
		} catch (error) {
			this.fail(error);
			return false;
		}
	}
}

export async function prepareHighlight(name: string) {
	await getSharedHighlighter({
		themes: ["github-light"],
		langs: ["text", getFiletypeFromFileName(name)],
		preferredHighlighter: "shiki-js",
	});
}

export function createRenderer(options: FileDiffOptions<undefined, undefined>, fail: (error: unknown) => void) {
	return new ContainedDiff(options, fail);
}
