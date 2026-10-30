import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
	createFilePatch,
	FILE_PATCH_LIMIT,
	FILE_RAW_LIMIT,
	GitOutputLimitError,
	type GitProcess,
} from "../../../../../lib/git/index.ts";
import type { ResolvedCodebase } from "../../../../workspace-config/index.ts";
import {
	createScope,
	inside,
	type RepositoryResolution,
	repositoryExclusions,
} from "../../../../workspace-repositories/index.ts";
import type { LineStatistics, TreeNode, WorkspaceTree } from "../../../../workspace-tree/index.ts";
import { createCurrentPath } from "./current-path.ts";
import type { CollectedChange } from "./types.ts";

export type Baseline = { kind: "commit"; oid: string } | { kind: "unborn" };
export type FilePatchContext = 3 | "all";
export interface FileSide {
	path: string;
	kind: "file" | "symlink" | "directory";
	mode: string;
	present: boolean;
	codebase?: ResolvedCodebase;
}
export class SourceForbiddenError extends Error {}
export interface Descriptor {
	repository: Extract<RepositoryResolution, { status: "available" }>;
	change: CollectedChange;
}
export interface FileDeps {
	root: string;
	repositories: readonly RepositoryResolution[];
	git: GitProcess;
	descriptors: WeakMap<WorkspaceTree, ReadonlyMap<string, Descriptor>>;
}
interface Metadata {
	path: string;
	repo: string;
	baseline: Baseline;
	context: FilePatchContext;
	changeKind: "added" | "modified" | "deleted" | "renamed";
	from?: string;
	base: FileSide;
	current: FileSide;
	statistics: LineStatistics;
}
export type FileDiffResult =
	| { kind: "not_changed" }
	| (Metadata &
			(
				| { kind: "text"; patch: string }
				| { kind: "metadata_only" }
				| { kind: "unsupported"; reason: "binary" | "encoding" | "too_large"; limitBytes?: number }
			));

export function createFileDiff(deps: FileDeps) {
	const currentPath = createCurrentPath(deps);
	async function validateCurrent(descriptor: Descriptor, node: TreeNode | undefined, signal?: AbortSignal) {
		const { change, repository } = descriptor;
		const directory =
			change.newMode === "040000" || (change.newMode === "000000" && node?.current?.kind === "directory");
		// A collector-absent side stays absent even if an ignored physical recreation exists.
		if (change.newMode === "000000" && !directory) return;
		const { target, stat } = await currentPath(repository, node?.path ?? change.path, signal);
		if (directory) {
			if (!stat.isDirectory()) throw new Error("Current directory side changed kind");
			return;
		}
		if (change.newMode === "120000") {
			if (stat.isSymbolicLink()) return;
			const config = await deps.git(repository.gitRoot, ["config", "--bool", "core.symlinks"], { signal });
			if (config.code !== 0 || config.stdout.toString().trim() !== "false" || !stat.isFile())
				throw new Error("Current link side changed kind");
		} else if (!stat.isFile()) throw new Error("Current regular side changed kind");
		const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const actual = await handle.stat();
			if (!actual.isFile() || actual.ino !== stat.ino || actual.dev !== stat.dev)
				throw new Error("Current side changed kind");
			if (actual.size > FILE_RAW_LIMIT) return FILE_RAW_LIMIT;
		} finally {
			await handle.close();
		}
		signal?.throwIfAborted();
	}
	return async (
		tree: WorkspaceTree,
		path: string,
		signal?: AbortSignal,
		context: FilePatchContext = 3,
	): Promise<FileDiffResult> => {
		const descriptors = deps.descriptors.get(tree);
		if (!descriptors) throw new Error("Unknown source collection");
		const descriptor = descriptors.get(path);
		if (!descriptor) {
			const repository = [...deps.repositories]
				.sort((a, b) => b.path.length - a.path.length)
				.find((r) => inside(resolve(deps.root, r.path), resolve(deps.root, path)));
			if (repository?.status !== "available") throw new SourceForbiddenError("Path does not participate");
			const participant = resolve(deps.root, repository.path);
			const local = relative(repository.gitRoot, resolve(deps.root, path)).split(sep).join("/");
			if (
				!(await createScope(
					repository.gitRoot,
					deps.root,
					participant,
					repositoryExclusions(deps.root, repository.path, participant, deps.repositories),
				)(local))
			)
				throw new SourceForbiddenError("Path does not participate");
			return { kind: "not_changed" };
		}
		const c = descriptor.change;
		const node = tree.nodes.get(path);
		const oldPath = node?.base?.path ?? path;
		const side = (version: "base" | "current", mode: string, sidePath: string): FileSide => {
			const observed = node?.[version];
			const directory = observed?.kind === "directory";
			return {
				path: sidePath,
				kind: directory ? "directory" : mode === "120000" ? "symlink" : "file",
				mode: mode === "000000" && directory ? "040000" : mode,
				present: mode !== "000000" || directory,
				...(observed?.codebase ? { codebase: observed.codebase } : {}),
			};
		};
		const metadata: Metadata = {
			path,
			repo: descriptor.repository.path,
			baseline: c.baseline.kind === "commit" ? { kind: "commit", oid: c.baseline.oid } : { kind: "unborn" },
			context,
			changeKind: c.kind,
			...(c.from ? { from: oldPath } : {}),
			base: side("base", c.oldMode, oldPath),
			current: side("current", c.newMode, path),
			statistics: c.statistics,
		};
		const rawLimit = await validateCurrent(descriptor, node, signal);
		if (rawLimit) return { ...metadata, kind: "unsupported", reason: "too_large", limitBytes: rawLimit };
		if (c.statistics.binary) return { ...metadata, kind: "unsupported", reason: "binary" };
		try {
			const patch = await createFilePatch(
				deps.git,
				descriptor.repository.gitRoot,
				{
					baselineOid: c.baseline.oid,
					oldPath: c.from ?? c.path,
					newPath: c.path,
					oldMode: c.oldMode,
					newMode: c.newMode,
					comparison: c.comparison,
					context,
					headerOldPath: oldPath,
					headerNewPath: path,
				},
				signal,
			);
			const afterLimit = await validateCurrent(descriptor, node, signal);
			if (afterLimit) return { ...metadata, kind: "unsupported", reason: "too_large", limitBytes: afterLimit };
			if (patch.includes(0)) return { ...metadata, kind: "unsupported", reason: "binary" };
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(patch);
			} catch {
				return { ...metadata, kind: "unsupported", reason: "encoding" };
			}
			return /^@@ /m.test(text) ? { ...metadata, kind: "text", patch: text } : { ...metadata, kind: "metadata_only" };
		} catch (error) {
			if (error instanceof GitOutputLimitError)
				return { ...metadata, kind: "unsupported", reason: "too_large", limitBytes: FILE_PATCH_LIMIT };
			throw error;
		}
	};
}
