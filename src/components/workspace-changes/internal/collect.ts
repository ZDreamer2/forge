import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
	CodebaseContext,
	RepositoryResolution,
	WorkspaceChange,
	WorkspacePolicy,
} from "../../workspace-policy/index.ts";
import { compareTrees } from "./comparison.ts";
import { createGit, type Git, gitEnvironment, line, nulRecords, objectId } from "./git.ts";
import { captureEntry, inside, parseTree, scopedPath, validTreePath, writeTree } from "./snapshot.ts";
import type { CollectedChange, TreeEntry } from "./types.ts";

interface Deps {
	readonly root: string;
	readonly repositories: readonly RepositoryResolution[];
	readonly codebasesForChange: WorkspacePolicy["codebasesForChange"];
	readonly env: Readonly<NodeJS.ProcessEnv>;
	readonly temporaryRoot?: string;
}

async function headEntries(git: Git): Promise<TreeEntry[]> {
	const head = await git.tryRun(["rev-parse", "--verify", "HEAD^{commit}"]);
	if (head.code === 0) {
		return parseTree(await git.run(["ls-tree", "-r", "-z", objectId(head.stdout)]));
	}
	const symbolic = await git.tryRun(["symbolic-ref", "-q", "HEAD"]);
	if (symbolic.code === 0) {
		const name = line(symbolic.stdout);
		if (name.startsWith("refs/heads/")) {
			const reference = await git.tryRun(["show-ref", "--verify", "--quiet", name]);
			if (reference.code === 1) return [];
		}
	}
	throw new Error("Cannot resolve repository HEAD");
}

function memberships(value: unknown): readonly CodebaseContext[] {
	if (!Array.isArray(value)) throw new TypeError("Policy memberships must be an array");
	return Array.from(value, (item: unknown) => {
		if (
			item === null ||
			typeof item !== "object" ||
			!("id" in item) ||
			!("guidance" in item) ||
			typeof item.id !== "string" ||
			item.id.trim().length === 0 ||
			typeof item.guidance !== "string" ||
			item.guidance.trim().length === 0
		) {
			throw new TypeError("Policy memberships need nonempty id and guidance strings");
		}
		return { id: item.id, guidance: item.guidance };
	});
}

function workspacePath(root: string, gitRoot: string, path: string): string {
	return relative(root, resolve(gitRoot, path)).split(sep).join("/");
}

function quotedAlternate(path: string): Buffer {
	const parts = ['"'];
	for (const byte of Buffer.from(path)) {
		parts.push(
			byte >= 32 && byte < 127 && byte !== 34 && byte !== 92
				? String.fromCharCode(byte)
				: `\\${byte.toString(8).padStart(3, "0")}`,
		);
	}
	parts.push('"\n');
	return Buffer.from(parts.join(""));
}

export function createWorkspaceChanges(deps: Deps) {
	const env = gitEnvironment(deps.env);
	const repositories = deps.repositories.map((repository) => ({ ...repository }));
	const root = resolve(deps.root);
	const temporaryRoot = deps.temporaryRoot ?? deps.env.TMPDIR ?? deps.env.TEMP ?? deps.env.TMP ?? "/tmp";
	if (!isAbsolute(temporaryRoot)) throw new Error("Temporary collection root must be absolute");
	return {
		async collect(): Promise<readonly CollectedChange[]> {
			if ((await realpath(root)) !== root) throw new Error("Workspace location changed");
			const scratchParent = await realpath(temporaryRoot);
			if (
				repositories.some(
					(repository) => repository.status === "available" && inside(repository.gitRoot, scratchParent),
				)
			) {
				throw new Error("Temporary collection state must be outside participating checkouts");
			}
			const scratch = await mkdtemp(resolve(scratchParent, "forge-changes-"));
			try {
				const changes: CollectedChange[] = [];
				for (const [number, repository] of repositories.entries()) {
					if (repository.status === "missing") continue;
					const location = resolve(root, repository.path);
					const participantRoot = await realpath(location);
					if (!inside(root, participantRoot) || !(await lstat(participantRoot)).isDirectory()) {
						throw new Error("Participating repository location changed");
					}
					const source = createGit(participantRoot, env);
					const currentRoot = await realpath(line(await source.run(["rev-parse", "--show-toplevel"])));
					if (currentRoot !== repository.gitRoot || (repository.path !== "." && currentRoot !== participantRoot)) {
						throw new Error("Participating repository Git root changed");
					}
					const sourceGit = createGit(currentRoot, env);
					const heads = await headEntries(sourceGit);
					const candidates = new Set(heads.map((entry) => entry.path));
					for (const path of nulRecords(
						await sourceGit.run([
							"ls-files",
							"--cached",
							"--others",
							"--exclude-standard",
							"-z",
							"--",
							relative(currentRoot, participantRoot) || ".",
						]),
					)) {
						// Git represents an untracked nested checkout as a directory, never file content.
						if (path.endsWith("/")) continue;
						validTreePath(path);
						candidates.add(path);
					}
					const exclusions = repositories.flatMap((item, index) => {
						if (index === number) return [];
						const logical = resolve(root, item.path);
						const paths = [logical];
						if (item.path !== "." && item.status === "available") paths.push(item.gitRoot);
						if (inside(location, logical)) paths.push(resolve(participantRoot, relative(location, logical)));
						return paths.filter((path) => path !== participantRoot && inside(participantRoot, path));
					});
					const scoped = new Set<string>();
					for (const path of candidates) {
						if (await scopedPath(currentRoot, root, participantRoot, exclusions, path)) scoped.add(path);
					}
					const baseEntries = heads.filter((entry) => entry.mode !== "160000" && scoped.has(entry.path));
					const modes = new Map(baseEntries.map((entry) => [entry.path, entry.mode]));
					const gitlinks = new Set(heads.filter((entry) => entry.mode === "160000").map((entry) => entry.path));
					const directory = resolve(scratch, String(number));
					const objects = resolve(directory, "objects");
					await mkdir(resolve(objects, "info"), { recursive: true });
					await mkdir(resolve(directory, "worktree"));
					const sourceObjects = line(
						await sourceGit.run(["rev-parse", "--path-format=absolute", "--git-path", "objects"]),
					);
					await writeFile(resolve(objects, "info", "alternates"), quotedAlternate(sourceObjects));
					const git = createGit(resolve(directory, "worktree"), {
						...env,
						GIT_DIR: line(await sourceGit.run(["rev-parse", "--absolute-git-dir"])),
						GIT_WORK_TREE: resolve(directory, "worktree"),
						GIT_INDEX_FILE: resolve(directory, "index"),
						GIT_OBJECT_DIRECTORY: objects,
					});
					const empty = await writeTree(git, []);
					const base = await writeTree(git, baseEntries);
					const configured = await sourceGit.tryRun(["config", "--bool", "core.fileMode"]);
					if (configured.code !== 0 && configured.code !== 1)
						throw new Error("Cannot read repository file-mode configuration");
					const fileMode = configured.code === 1 || line(configured.stdout) !== "false";
					const finalEntries: TreeEntry[] = [];
					for (const path of [...scoped].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
						if (gitlinks.has(path)) continue;
						const entry = await captureEntry(currentRoot, path, modes.get(path), fileMode, git);
						if (entry) finalEntries.push(entry);
					}
					const final = await writeTree(git, finalEntries);
					// Git's attribute reader uses its current working directory, even with an
					// alternate worktree. Only captured attributes belong in that directory.
					for (const entry of finalEntries) {
						if (basename(entry.path) !== ".gitattributes" || !entry.mode.startsWith("100")) continue;
						const target = resolve(directory, "worktree", entry.path);
						await mkdir(dirname(target), { recursive: true });
						await writeFile(target, await git.run(["cat-file", "blob", entry.oid]));
					}
					const compared = await compareTrees(git, base, final, empty);
					const entries = compared.map((item) => {
						const publishedPath = (path: string) =>
							repository.path === "." ? workspacePath(root, currentRoot, path) : `${repository.path}/${path}`;
						const change: WorkspaceChange = {
							...item.change,
							repo: repository.path,
							path: publishedPath(item.change.path),
							...(item.change.from === undefined ? {} : { from: publishedPath(item.change.from) }),
						};
						return {
							...change,
							binary: item.binary,
							addedLines: item.addedLines,
							removedLines: item.removedLines,
							codebases: memberships(deps.codebasesForChange(change)),
						};
					});
					entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
					changes.push(...entries);
				}
				return changes;
			} finally {
				await rm(scratch, { recursive: true, force: true });
			}
		},
	};
}
