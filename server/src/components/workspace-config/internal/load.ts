import { lstat, readFile, readlink, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parse } from "yaml";
import {
	type ResolvedCodebase,
	type UnavailableCodebase,
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
		if (basename(path) === "forge-codebase-type.yaml")
			throw new WorkspaceConfigError(
				`${config}: legacy forge-codebase-type.yaml reference; migrate to forge-codebase.yaml with id and parents, registered in codebases`,
			);
		if (basename(path) !== filename)
			throw new WorkspaceConfigError(`${config}: ${key} must reference ${filename} files`);
		const target = await canonical(`${dirname(config)}/${path}`);
		if (seen.has(target)) throw new WorkspaceConfigError(`${config}: duplicate ${key} reference ${target}`);
		seen.add(target);
		paths.push(target);
	}
	return paths;
}

function rejectLegacy(config: string, data: Record<string, unknown>): void {
	if (Object.hasOwn(data, "analysis_handlers"))
		throw new WorkspaceConfigError(
			`${config}: analysis_handlers is unsupported; move policy to the guide fixed entry forge-extension/forge-extension.ts with a default ForgeExtension export`,
		);
	for (const key of ["type", "codebase_types"]) {
		if (Object.hasOwn(data, key))
			throw new WorkspaceConfigError(
				`${config}: legacy ${JSON.stringify(key)} is unsupported; migrate to codebases registrations of forge-codebase.yaml with stable id and ordered parents`,
			);
	}
}

function parents(config: string, data: Record<string, unknown>): readonly string[] {
	const raw = Object.hasOwn(data, "parents") ? data.parents : [];
	if (!Array.isArray(raw)) throw new WorkspaceConfigError(`${config}: parents must be an ordered list of distinct IDs`);
	const result: string[] = [];
	for (const value of raw) {
		const id = string(value, `${config}: parent ID`);
		if (result.includes(id)) throw new WorkspaceConfigError(`${config}: duplicate parent ID ${JSON.stringify(id)}`);
		result.push(id);
	}
	return result;
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
	rejectLegacy(config, data);
	const workspace = { guide: dirname(config), parents: parents(config, data) };
	const guides: ResolvedCodebase[] = [];
	const unavailable: UnavailableCodebase[] = [];
	const roots = new Set<string>();
	const identifiers = new Set<string>();
	for (const marker of await references(config, data, "codebases", "forge-codebase.yaml")) {
		if (!(await exists(marker))) {
			unavailable.push({ marker, reason: "marker is missing" });
			continue;
		}
		const declaration = await mapping(marker);
		rejectLegacy(marker, declaration);
		const id = string(declaration.id, `${marker}: id`);
		const inherited = parents(marker, declaration);
		let root: string | undefined;
		if (Object.hasOwn(declaration, "root")) {
			// Source roots stay lexical, including symlinks; marker references are canonical.
			root = resolve(dirname(marker), relative(declaration.root, `${marker}: root`));
			if (!(await exists(root))) {
				unavailable.push({ marker, id, reason: `root is missing: ${root}` });
				continue;
			}
			if (!(await stat(root)).isDirectory())
				throw new WorkspaceConfigError(`${marker}: Codebase root is not a directory: ${root}`);
		}
		if (identifiers.has(id)) throw new WorkspaceConfigError(`${marker}: Duplicate codebase ID ${JSON.stringify(id)}`);
		if (root !== undefined && roots.has(root))
			throw new WorkspaceConfigError(`${marker}: Duplicate codebase root ${root}`);
		identifiers.add(id);
		if (root !== undefined) roots.add(root);
		guides.push({
			id,
			guide: dirname(marker),
			parents: inherited,
			...(root === undefined ? {} : { root }),
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
		repositories,
		workspace,
		guides,
		unavailable,
		...(displayName === undefined ? {} : { displayName }),
	};
}
