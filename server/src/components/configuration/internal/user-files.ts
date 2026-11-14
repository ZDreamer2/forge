import { readFile } from "node:fs/promises";
import { isScalar, parseDocument } from "yaml";
import { ConfigurationError, type Loaded, type ServerRegistration } from "./types.ts";

export async function readText(path: string): Promise<string | undefined> {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (cause) {
		if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
		throw new ConfigurationError("$: cannot read source file", { cause });
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (cause) {
		throw new ConfigurationError("$: source must be UTF-8", { cause });
	}
}

function object(value: unknown, field: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new ConfigurationError(`${field}: expected an object`);
	return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key))
			throw new ConfigurationError(`${field}[${JSON.stringify(key).slice(0, 80)}]: unsupported field in this file`);
	}
}

async function yaml(path: string, allowed: readonly string[]): Promise<Loaded<Record<string, unknown>>> {
	const text = await readText(path);
	if (text === undefined) return { value: {}, provenance: "default" };
	let value: unknown;
	try {
		const document = parseDocument(text, { uniqueKeys: true, stringKeys: true, schema: "core" });
		const problem = document.errors[0] ?? document.warnings[0];
		if (problem) {
			const position = problem.linePos?.[0];
			throw new ConfigurationError(
				`$: invalid data-only YAML (${problem.code}${position ? ` at line ${position.line}, column ${position.col}` : ""}); check syntax, tags and duplicate keys`,
			);
		}
		value =
			document.contents === null ||
			(isScalar(document.contents) && document.contents.value === null && document.contents.source === "")
				? {}
				: document.toJS({ maxAliasCount: 100 });
	} catch (cause) {
		if (cause instanceof ConfigurationError) throw cause;
		throw new ConfigurationError("$: invalid data-only YAML (check syntax, tags and duplicate keys)", { cause });
	}
	const mapping = object(value, "$");
	fields(mapping, allowed, "$");
	return { value: mapping, provenance: "file" };
}

function serverUrl(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() !== value || !/^https?:\/\//i.test(value))
		throw new ConfigurationError(`${field}: expected an absolute HTTP(S) server base URL`);
	let url: URL;
	try {
		url = new URL(value);
	} catch (cause) {
		throw new ConfigurationError(`${field}: expected an absolute HTTP(S) server base URL`, { cause });
	}
	if (
		!url.hostname ||
		url.username ||
		url.password ||
		/^https?:\/\/[^/]*@/i.test(value) ||
		value.includes("\\") ||
		value.includes("?") ||
		value.includes("#") ||
		Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
	)
		throw new ConfigurationError(`${field}: URL must have a host and no credentials, query, fragment or whitespace`);
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
	return url.href;
}

export async function loadServerHubUrl(path: string): Promise<Loaded<string | undefined>> {
	const loaded = await yaml(path, ["serverHubUrl"]);
	return {
		value: Object.hasOwn(loaded.value, "serverHubUrl")
			? serverUrl(loaded.value.serverHubUrl, "serverHubUrl")
			: undefined,
		provenance: loaded.provenance,
	};
}

export async function loadServers(path: string): Promise<Loaded<readonly ServerRegistration[]>> {
	const loaded = await yaml(path, ["servers"]);
	const raw = Object.hasOwn(loaded.value, "servers") ? loaded.value.servers : [];
	if (!Array.isArray(raw)) throw new ConfigurationError("servers: expected an ordered list");
	const seen = new Set<string>();
	const registrations = raw.map((entry: unknown, index) => {
		const field = `servers[${index}]`;
		const data = object(entry, field);
		fields(data, ["id", "name", "url"], field);
		if (typeof data.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(data.id))
			throw new ConfigurationError(`${field}.id: expected a nonempty ASCII slug`);
		if (seen.has(data.id)) throw new ConfigurationError(`${field}.id: duplicate registration ID`);
		seen.add(data.id);
		if (typeof data.name !== "string" || !data.name.trim())
			throw new ConfigurationError(`${field}.name: expected a nonblank display string`);
		return Object.freeze({ id: data.id, name: data.name, url: serverUrl(data.url, `${field}.url`) });
	});
	return { value: Object.freeze(registrations), provenance: loaded.provenance };
}
