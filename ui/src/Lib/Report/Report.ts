export function reportUnexpectedError(error: unknown) {
	try {
		console.error("Unexpected Forge failure", error);
	} catch {
		// Recovery must remain available even when the reporting destination fails.
	}
}
