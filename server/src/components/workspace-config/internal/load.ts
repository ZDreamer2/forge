import { lstat, readFile, readlink, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parse } from "yaml";
import {
	type ResolvedAnalysisHandler,
	type ResolvedCodebase,
	type ResolvedCodebaseType,
	type WorkspaceConfig,
	WorkspaceConfigError,
} from "./types.ts";

function absent(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function canonical(path: string, links = 0): Promise<string> {
	if (links > 40) throw new WorkspaceConfigError(`Too many symbolic links in configuration path ${path}`);
	let current = "/";
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const next = `${current}/${part}`;
		try {
			if ((await lstat(next)).isSymbolicLink()) {
				const target = await readlink(next);
				current = await canonical(isAbsolute(target) ? target : `${dirname(next)}/${target}`, links + 1);
			} else {
				current = resolve(next);
			}
		} catch (error) {
			if (!absent(error)) throw error;
			current = resolve(next);
		}
	}
	return current;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (absent(error)) return false;
		throw error;
	}
}

async function mapping(path: string): Promise<Record<string, unknown>> {
	try {
		const value: unknown = parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)), {
			uniqueKeys: true,
			stringKeys: true,
			logLevel: "error",
		});
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected a mapping");
		return value as Record<string, unknown>;
	} catch (cause) {
		throw new WorkspaceConfigError(`Invalid Forge configuration ${path}`, { cause });
	}
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
		throw new WorkspaceConfigError(`${label} must be a nonempty string without NUL`);
	}
	return value;
}

function relative(value: unknown, label: string): string {
	const path = string(value, label);
	if (isAbsolute(path)) throw new WorkspaceConfigError(`${label} must be relative to its YAML file`);
	return path;
}

async function references(config: string, data: Record<string, unknown>, key: string, filename: string) {
	const raw = data[key];
	if (!Array.isArray(raw)) throw new WorkspaceConfigError(`${config}: ${key} must be a list`);
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const value of raw) {
		const path = relative(value, `${config}: ${key} entry`);
		if (basename(path) !== filename)
			throw new WorkspaceConfigError(`${config}: ${key} must reference ${filename} files`);
		const target = await canonical(`${dirname(config)}/${path}`);
		if (seen.has(target)) throw new WorkspaceConfigError(`${config}: duplicate ${key} reference ${target}`);
		seen.add(target);
		if (await exists(target)) paths.push(target);
	}
	return paths;
}

function analysisHandlers(config: string, data: Record<string, unknown>): readonly ResolvedAnalysisHandler[] {
	if (!Object.hasOwn(data, "analysis_handlers")) return [];
	const raw = data.analysis_handlers;
	if (!Array.isArray(raw)) throw new WorkspaceConfigError(`${config}: analysis_handlers must be a list`);
	return raw.map((value: unknown, index) => {
		const path = relative(value, `${config}: analysis_handlers entry`);
		if (!/^\.{1,2}\//.test(path) || !/\.(?:m?ts|m?js)$/.test(path) || path.includes("\\") || /[*?]/.test(path)) {
			throw new WorkspaceConfigError(`${config}: analysis_handlers requires explicit relative ESM module paths`);
		}
		return { modulePath: resolve(dirname(config), path), ordinal: index + 1 };
	});
}

export function validRepositoryPath(path: string): boolean {
	return (
		path === "." ||
		(path.length > 0 &&
			!path.includes("\\") &&
			!path.includes(":") &&
			!path.includes("\0") &&
			path.split("/").every((part) => part !== "" && part !== "." && part !== ".."))
	);
}

export async function loadWorkspaceConfig(absolutePath: string): Promise<WorkspaceConfig> {
	if (!isAbsolute(absolutePath)) throw new WorkspaceConfigError("Workspace configuration path must be absolute");
	const config = await canonical(absolutePath);
	const data = await mapping(config);
	const types = new Map<string, ResolvedCodebaseType>();
	for (const marker of await references(config, data, "codebase_types", "forge-codebase-type.yaml")) {
		const id = string((await mapping(marker)).id, `${marker}: id`);
		if (types.has(id)) throw new WorkspaceConfigError(`Duplicate codebase type ID ${id}`);
		types.set(id, { id, guide: dirname(marker) });
	}
	const codebases: ResolvedCodebase[] = [];
	const roots = new Set<string>();
	for (const marker of await references(config, data, "codebases", "forge-codebase.yaml")) {
		const concrete = await mapping(marker);
		// Concrete roots stay lexical, including symlinks; marker references are canonical.
		const root = resolve(dirname(marker), relative(concrete.root, `${marker}: root`));
		if (!(await exists(root))) continue;
		if (!(await stat(root)).isDirectory()) throw new WorkspaceConfigError(`Codebase root is not a directory: ${root}`);
		if (roots.has(root)) throw new WorkspaceConfigError(`Duplicate codebase root ${root}`);
		roots.add(root);
		let type: ResolvedCodebaseType | undefined;
		if (Object.hasOwn(concrete, "type")) {
			const id = string(concrete.type, `${marker}: type`);
			type = types.get(id);
			if (!type) throw new WorkspaceConfigError(`${marker}: unknown codebase type ${id}`);
		}
		codebases.push({
			root,
			guide: dirname(marker),
			analysisHandlers: analysisHandlers(marker, concrete),
			...(type === undefined ? {} : { type }),
		});
	}
	if (!Array.isArray(data.repositories)) throw new WorkspaceConfigError(`${config}: repositories must be a list`);
	const seen = new Set<string>();
	const repositories = data.repositories.map((value: unknown) => {
		if (typeof value !== "string" || !validRepositoryPath(value) || seen.has(value)) {
			throw new WorkspaceConfigError("Repository declarations need unique normalized workspace-relative paths");
		}
		seen.add(value);
		return { path: value };
	});
	let displayName: string | undefined;
	if (Object.hasOwn(data, "display_name")) {
		if (typeof data.display_name !== "string" || data.display_name.length === 0) {
			throw new WorkspaceConfigError("Workspace display_name must be a nonempty string");
		}
		displayName = data.display_name;
	}
	return {
		analysisHandlers: analysisHandlers(config, data),
		repositories,
		codebases,
		codebaseTypes: [...types.values()],
		...(displayName === undefined ? {} : { displayName }),
	};
}
