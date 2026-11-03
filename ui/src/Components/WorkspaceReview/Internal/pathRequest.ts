export type PathRequest = { path: string; occurrence: number };
export type PathRequestCursor = {
	request?: PathRequest | undefined;
	origin?: string | undefined;
	addressed?: boolean;
	pending: boolean;
};

// A command can precede its address commit or canonical topology. Once consumed
// or superseded it must never replay on history, filters or a later observation.
export function consumePathRequest(
	cursor: PathRequestCursor,
	request: PathRequest | undefined,
	selectedPath: string | undefined,
	resolved: boolean,
): boolean {
	if (cursor.request?.occurrence !== request?.occurrence || cursor.request?.path !== request?.path) {
		cursor.request = request;
		cursor.origin = selectedPath;
		cursor.addressed = false;
		cursor.pending = request !== undefined;
	}
	if (!cursor.pending || !request) return false;
	if (selectedPath !== request.path) {
		if (cursor.addressed || selectedPath !== cursor.origin) cursor.pending = false;
		return false;
	}
	cursor.addressed = true;
	if (!resolved) return false;
	cursor.pending = false;
	return true;
}
