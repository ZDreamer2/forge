/** URLSearchParams performs the single decoding pass; paths remain literal thereafter. */
export function parseFileQuery(url: string) {
	const query = new URL(url).searchParams;
	const allowed = new Set(["path", "context"]);
	for (const key of query.keys()) if (!allowed.has(key) || query.getAll(key).length !== 1) return undefined;
	const path = query.get("path");
	const canonical = (value: string | null): value is string =>
		value !== null &&
		value.length > 0 &&
		!/[\0\\]/.test(value) &&
		!/^[a-z]:/i.test(value) &&
		value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
	if (!canonical(path)) return undefined;
	const context = query.get("context");
	if (context !== null && context !== "3" && context !== "all") return undefined;
	return { path, context: context === "all" ? ("all" as const) : (3 as const) };
}
