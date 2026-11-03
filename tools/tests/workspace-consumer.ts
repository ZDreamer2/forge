import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { findPackageJSON } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyInstalledAnalysis } from "./workspace-consumer-analysis.ts";
import { verifyInstalledFiles } from "./workspace-consumer-files.ts";
import { verifyInstalledUi } from "./workspace-consumer-ui.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--built"), "test:workspace accepts only --built");
// biome-ignore lint/style/noProcessEnv: CI explicitly chooses where its checked artifact is retained.
const artifactDirectory = process.env.FORGE_CHECKED_PACKAGE_DIR;
// biome-ignore lint/style/noProcessEnv: Optional local distribution acceptance is explicitly supplied by the caller.
const generatedBaseGuide = process.env.FORGE_GENERATED_BASE_GUIDE;
assert.ok(!generatedBaseGuide || generatedBaseGuide.startsWith("/"), "Generated base guide must be absolute");
assert.ok(!artifactDirectory || artifactDirectory.startsWith("/"), "Artifact directory must be absolute");
const temporary = mkdtempSync(join(tmpdir(), "forge-consumer-"));
function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
	assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function portReservation(port = 0) {
	const server = createServer();
	try {
		await bounded(
			new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, "127.0.0.1", resolve);
			}),
			"Port reservation",
		);
	} catch (error) {
		server.close();
		throw error;
	}
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	return {
		port: address.port,
		close: () =>
			bounded(
				new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				}),
				"Port release",
			),
	};
}

async function foreignHostStatus(address: string, path: string) {
	return bounded(
		new Promise<number | undefined>((resolve, reject) => {
			const request = httpRequest(`${address}${path}`, { headers: { host: "foreign.invalid" } }, (response) => {
				response.resume();
				response.once("end", () => resolve(response.statusCode));
				response.once("error", reject);
			});
			request.once("error", reject);
			request.setTimeout(5000, () => request.destroy(new Error("Host probe timed out")));
			request.end();
		}),
		"Host probe",
	);
}

function snapshot(directory: string, omitGit = false): Record<string, string> {
	const files: Record<string, string> = {};
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (omitGit && entry.name === ".git") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			for (const [name, bytes] of Object.entries(snapshot(path, omitGit))) files[`${entry.name}/${name}`] = bytes;
		} else if (entry.isSymbolicLink()) files[entry.name] = `symlink:${readlinkSync(path)}`;
		else files[entry.name] = `${omitGit ? `${lstatSync(path).mode}:` : ""}${readFileSync(path).toString("base64")}`;
	}
	return files;
}

function sourceState(workspace: string) {
	return {
		files: snapshot(workspace, true),
		repositories: [workspace, join(workspace, "nested")].map((repository) => {
			const git = join(repository, ".git");
			return {
				index: readFileSync(join(git, "index")).toString("base64"),
				head: readFileSync(join(git, "HEAD")).toString("base64"),
				refs: snapshot(join(git, "refs")),
				objects: snapshot(join(git, "objects")),
				packedRefs: existsSync(join(git, "packed-refs"))
					? readFileSync(join(git, "packed-refs")).toString("base64")
					: null,
			};
		}),
	};
}

async function installedServer(executable: string, cwd: string, workspace: string, port: number) {
	// Ignore ambient configuration and module injection: only the installed package supplies runtime code.
	// biome-ignore lint/style/noProcessEnv: subprocess fixture explicitly sanitizes the inherited execution environment.
	const { NODE_PATH: _nodePath, NODE_OPTIONS: _nodeOptions, ...environment } = process.env;
	const child = spawn(executable, ["serve", "--workspace", workspace], {
		cwd,
		env: { ...environment, ZD_AI_FORGE_WORKSPACE_GUIDE: "", ZD_AI_FORGE_PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let resolveReady: (() => void) | undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	child.stdout.on("data", (data: Buffer) => {
		stdout += data.toString();
		if (stdout.includes(`http://127.0.0.1:${port}\n`)) resolveReady?.();
	});
	child.stderr.on("data", (data: Buffer) => {
		stderr += data.toString();
	});
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	const stop = async (signal: NodeJS.Signals) => {
		if (child.exitCode === null && child.signalCode === null) child.kill(signal);
		return bounded(exited, "Installed server shutdown");
	};
	try {
		await bounded(
			Promise.race([
				ready,
				exited.then(() => {
					throw new Error(`Installed server exited before readiness: ${stderr}`);
				}),
			]),
			"Installed server readiness",
		);
		const manifestPath = findPackageJSON(pathToFileURL(realpathSync(executable)));
		assert.ok(manifestPath);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		assert.equal(
			stdout,
			`Forge @zdreamer/forge ${manifest.version}\nExecutable: ${JSON.stringify(realpathSync(executable))}\nWorkspace: ${JSON.stringify(workspace)}\nhttp://127.0.0.1:${port}\n`,
		);
	} catch (error) {
		await stop("SIGKILL").catch(() => {});
		throw error;
	}
	return { address: `http://127.0.0.1:${port}`, stop, stderr: () => stderr };
}

async function verifyServer(executable: string, consumer: string) {
	const workspace = join(consumer, "fixture");
	const workspaceName = `Fixture <workspace> & "name" ${"x".repeat(180)}`;
	mkdirSync(join(workspace, "docs/forge/workspace"), { recursive: true });
	mkdirSync(join(workspace, "nested"));
	for (const path of ["app", "other", "docs/<guidance>/app", "docs/<guidance>/other", "nested/docs", "docs/type"]) {
		mkdirSync(join(workspace, path), { recursive: true });
	}
	writeFileSync(join(workspace, "docs/type/forge-codebase.yaml"), 'id: "forge-base"\n');
	mkdirSync(join(workspace, "docs/type/forge-extension"));
	copyFileSync(
		resolve(root, "../../../ai/bc-plugins/dev/forge/codebases/base/forge-extension/forge-extension.ts"),
		join(workspace, "docs/type/forge-extension/forge-extension.ts"),
	);
	mkdirSync(join(workspace, "docs/forge/workspace/forge-extension"));
	writeFileSync(
		join(workspace, "docs/forge/workspace/forge-extension/forge-extension.ts"),
		`import type { ForgeExtension } from '@zdreamer/forge/extension';
export default {
  api: 1,
  annotateNode({node}) {
    if (node.path === 'app/tracked.txt') node.emphasize('Critical browser fixture');
    if (node.path === 'app/hidden.txt') node.hide('Hidden browser fixture');
    if (node.path === 'app/tests/critical.txt') node.restoreNormalEmphasis('Restore browser fixture');
    if (node.path === '.') node.notice('Workspace repository notice');
    if (node.path === 'app') node.notice('Direct folder notice');
    if (node.path === 'app/hidden.txt') node.warn('Hidden source warning', {side: 'current', line: 1, column: 2});
    if (node.path === 'app/tracked.txt') node.warn('Tracked source warning');
    if (node.path === 'nested') node.notice('Nested repository notice');
    if (node.path === 'nested/browser-binary.dat') node.warn('Nested descendant warning');
    if (node.path === 'other/renamed.txt') node.notice('Renamed source notice', {side: 'base', line: 1, column: 3});
    if (node.path.startsWith('app/bulk/file-0')) node.notice('Bulk detail message ' + node.path);
    if (node.path.startsWith('app/deep/') && node.kind) node.notice('Long source message ' + 'wrapped content '.repeat(22));
  },
} satisfies ForgeExtension;
`,
	);
	for (const path of ["app", "other"]) {
		writeFileSync(
			join(workspace, `docs/<guidance>/${path}/forge-codebase.yaml`),
			`id: fixture-${path}\nroot: ../../../${path}\nparents: [forge-base]\n`,
		);
	}
	writeFileSync(join(workspace, "nested/docs/forge-codebase.yaml"), "id: nested-guide\nroot: ..\n");
	writeFileSync(join(workspace, ".gitignore"), "nested/\n.env\n");
	writeFileSync(join(workspace, "app/tracked.txt"), "original\n");
	writeFileSync(join(workspace, "app/old.txt"), "rename content\n");
	writeFileSync(join(workspace, "app/transition"), "original file\n");
	writeFileSync(
		join(workspace, "app/diff-context.ts"),
		Array.from({ length: 160 }, (_, i) => `export const line${i + 1} = ${i + 1};\n`).join(""),
	);
	writeFileSync(join(workspace, "app/diff-delete.txt"), "deleted text\n");
	writeFileSync(join(workspace, "app/diff-empty-delete.txt"), "");
	writeFileSync(join(workspace, "app/diff-crlf.txt"), "\uFEFFold\r\nlast\r\n");
	writeFileSync(join(workspace, "app/diff-eof.txt"), "old\r");
	writeFileSync(join(workspace, "app/diff-mode.txt"), "unchanged mode text\n");
	writeFileSync(join(workspace, "app/diff-rename.txt"), "pure rename payload\n");
	writeFileSync(
		join(workspace, "app/diff-rename-edited.txt"),
		"first rename line\nsecond rename line\nthird rename line\n",
	);
	writeFileSync(join(workspace, "app/diff-link.txt"), "regular text\n");
	writeFileSync(join(workspace, "nested/binary.dat"), Buffer.from([0, 1, 2]));
	writeFileSync(
		join(workspace, "docs/forge/workspace/forge-workspace.yaml"),
		`display_name: ${JSON.stringify(workspaceName)}
repositories: [., nested, not-cloned]
parents: [forge-base]
codebases:
  - ../../../docs/<guidance>/app/forge-codebase.yaml
  - ../../../docs/<guidance>/other/forge-codebase.yaml
  - ../../../nested/docs/forge-codebase.yaml
  - ../../../docs/type/forge-codebase.yaml
`,
	);
	for (const repository of [workspace, join(workspace, "nested")]) {
		run("git", ["init", "-q", repository], consumer);
		run("git", ["add", "."], repository);
		run(
			"git",
			["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"],
			repository,
		);
	}
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		const reservation = await portReservation();
		await reservation.close();
		const beforeStartup = sourceState(workspace);
		const server = await installedServer(executable, consumer, workspace, reservation.port);
		const request = (path: string, options: RequestInit = {}) =>
			fetch(`${server.address}${path}`, {
				...options,
				signal: AbortSignal.timeout(5000),
			});
		try {
			assert.deepEqual(sourceState(workspace), beforeStartup);
			const identity = await request("/api/workspace");
			assert.equal(identity.status, 200);
			assert.deepEqual(await identity.json(), {
				workspace: { root: workspace, name: workspaceName },
				repositories: [
					{ path: ".", status: "available", gitRoot: workspace },
					{ path: "nested", status: "available", gitRoot: join(workspace, "nested") },
					{ path: "not-cloned", status: "missing" },
				],
			});
			const page = await request("/");
			assert.equal(page.status, 200);
			assert.match(page.headers.get("content-type") ?? "", /text\/html/);
			const html = await page.text();
			assert.match(html, /<div id="root"><\/div>/);
			const assetPaths = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
			assert.ok(
				assetPaths.some((path) => path?.endsWith(".js")),
				"Delivered module entry is required",
			);
			assert.ok(
				assetPaths.some((path) => path?.endsWith(".css")),
				"Delivered styles are required",
			);
			for (const path of assetPaths) {
				assert.ok(path && /^\/assets\/[\w.-]+-[-\w]+\.(js|css)$/.test(path));
				const asset = await request(path);
				assert.equal(asset.status, 200);
				assert.match(asset.headers.get("content-type") ?? "", path.endsWith(".js") ? /javascript/ : /text\/css/);
				assert.ok((await asset.text()).length > 0);
				const head = await request(path, { method: "HEAD" });
				assert.equal(head.status, 200);
				assert.equal(await head.text(), "");
			}
			assert.equal((await request("/assets/missing-123.js")).status, 404);
			const head = await request("/", { method: "HEAD" });
			assert.equal(head.status, 200);
			assert.equal(await head.text(), "");
			for (const path of [
				"/",
				...assetPaths.filter((path): path is string => path !== undefined),
				"/api/workspace",
				"/api/changes",
			]) {
				assert.equal((await request(path, { headers: { origin: "https://foreign.invalid" } })).status, 403);
				assert.equal(await foreignHostStatus(server.address, path), 403);
				const unsupported = await request(path, { method: "POST" });
				assert.equal(unsupported.status, 405);
				assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
			}
			const unknown = await request("/unknown");
			assert.equal(unknown.status, 404);
			assert.deepEqual(await unknown.json(), { error: { code: "not_found", message: "Not found" } });
			assert.deepEqual(sourceState(workspace), beforeStartup);
			if (signal === "SIGTERM") {
				await verifyInstalledUi({ address: server.address, workspace, workspaceName, sourceState, run });
				assert.deepEqual(await (await request("/api/changes")).json(), { codebases: {}, changes: [] });
				assert.deepEqual(sourceState(workspace), beforeStartup);
				writeFileSync(join(workspace, "app/tracked.txt"), "staged\n");
				run("git", ["add", "app/tracked.txt"], workspace);
				writeFileSync(join(workspace, "app/tracked.txt"), "first\n");
				renameSync(join(workspace, "app/old.txt"), join(workspace, "other/renamed.txt"));
				run("git", ["add", "app/old.txt", "other/renamed.txt"], workspace);
				writeFileSync(join(workspace, "nested/binary.dat"), Buffer.from([0, 4, 5]));
				writeFileSync(join(workspace, "outside.txt"), "no membership\n");
				const edited = sourceState(workspace);
				const response = await request("/api/changes");
				assert.equal(response.status, 200);
				const { codebases, changes } = (await response.json()) as {
					codebases: Record<string, { id: string; root: string; guidance: string }>;
					changes: Record<string, unknown>[];
				};
				assert.deepEqual(codebases, {
					app: { id: "fixture-app", root: "app", guidance: "docs/<guidance>/app" },
					other: { id: "fixture-other", root: "other", guidance: "docs/<guidance>/other" },
					nested: { id: "nested-guide", root: "nested", guidance: "nested/docs" },
				});
				assert.deepEqual(changes.find((change) => change.path === "other/renamed.txt")?.codebases, ["app", "other"]);
				assert.equal(changes.length, 4);
				for (const change of changes) {
					assert.equal("binary" in change, false);
					assert.equal("addedLines" in change, false);
					assert.equal("removedLines" in change, false);
				}
				assert.ok(
					changes.some(
						(change) =>
							change.repo === "." &&
							change.path === "other/renamed.txt" &&
							change.kind === "renamed" &&
							change.from === "app/old.txt",
					),
				);
				assert.ok(
					changes.some(
						(change) => change.repo === "nested" && change.path === "nested/binary.dat" && change.kind === "modified",
					),
				);
				assert.deepEqual(changes.find((change) => change.path === "outside.txt")?.codebases, []);
				assert.deepEqual(changes.find((change) => change.path === "app/tracked.txt")?.codebases, ["app"]);
				assert.deepEqual(sourceState(workspace), edited);
				writeFileSync(join(workspace, "app/tracked.txt"), "second\nextra\n");
				const refreshed = sourceState(workspace);
				const fresh = (await (await request("/api/changes")).json()) as { changes: Record<string, unknown>[] };
				assert.equal(fresh.changes.find((change) => change.path === "app/tracked.txt")?.kind, "modified");
				assert.deepEqual(sourceState(workspace), refreshed);
				writeFileSync(join(workspace, "app/fresh.txt"), "new after refresh\n");
				const withAddition = sourceState(workspace);
				const next = (await (await request("/api/changes")).json()) as { changes: Record<string, unknown>[] };
				assert.equal(next.changes.find((change) => change.path === "app/fresh.txt")?.kind, "added");
				assert.deepEqual(sourceState(workspace), withAddition);
			}
			const beforeShutdown = sourceState(workspace);
			assert.deepEqual(await server.stop(signal), { code: 0, signal: null }, server.stderr());
			assert.deepEqual(sourceState(workspace), beforeShutdown);
			const released = await portReservation(reservation.port);
			await released.close();
		} finally {
			await server.stop("SIGKILL");
		}
	}
}

function verifyInvalidStartup(executable: string, consumer: string) {
	const workspace = join(consumer, "invalid-fixture");
	const guide = join(workspace, "docs/forge/workspace");
	mkdirSync(guide, { recursive: true });
	const marker = join(guide, "forge-workspace.yaml");
	for (const [yaml, diagnostic] of [
		["repositories: [.]\ncodebases: []\nanalysis_handlers: []\n", /analysis_handlers.*forge-extension/s],
		["repositories: [.]\ncodebases: []\ncodebase_types: []\n", /legacy.*codebase_types.*migrate/s],
		["repositories: [.]\ncodebases: [forge-codebase-type.yaml]\n", /legacy.*forge-codebase-type.yaml.*migrate/s],
		["repositories: [.]\ncodebases: []\nparents: [unavailable-guide]\n", /unavailable-guide/],
	] as const) {
		writeFileSync(marker, yaml);
		const before = snapshot(workspace);
		const result = spawnSync(executable, ["serve", "--workspace", workspace], {
			cwd: consumer,
			encoding: "utf8",
			timeout: 5000,
			// biome-ignore lint/style/noProcessEnv: installed CLI fixtures override inherited workspace selection.
			env: { ...process.env, ZD_AI_FORGE_WORKSPACE_GUIDE: "", ZD_AI_FORGE_PORT: "47999" },
		});
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, diagnostic);
		assert.equal(result.stdout, "");
		assert.deepEqual(snapshot(workspace), before);
	}
}

try {
	// Build explicitly: installation/packing never executes package lifecycle scripts.
	if (!args.includes("--built"))
		run("corepack", ["pnpm", "--config.verify-deps-before-run=error", "run", "build"], root);
	const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], root));
	const consumer = join(temporary, "consumer");
	mkdirSync(consumer);
	writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--save-dev",
			"--save-exact",
			join(temporary, packed[0].filename),
		],
		consumer,
	);
	const installed = join(consumer, "node_modules/@zdreamer/forge");
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const installedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
	assert.equal(installedManifest.name, manifest.name);
	assert.equal(installedManifest.version, manifest.version);
	assert.equal(installedManifest.license, "MIT");
	assert.ok(existsSync(join(installed, "dist/server/src/components/api-contract/index.d.ts")));
	assert.ok(
		packed[0].files.every(
			(file: { path: string }) => !/(?:^|\/)(?:tests|Tests|tools|plans)\/|\.test\.|\.map$/.test(file.path),
		),
	);
	assert.ok(existsSync(join(installed, "dist/ui/index.html")));
	assert.ok(readdirSync(join(installed, "dist/ui/assets")).some((name) => name.endsWith(".css")));
	const notices = join(installed, "dist/ui/assets/licenses");
	const dependencyNotices = readFileSync(join(notices, "dependencies.md"), "utf8");
	assert.match(dependencyNotices, /@pierre\/diffs - 1\.6\.2/);
	assert.match(dependencyNotices, /Apache License/);
	assert.match(dependencyNotices, /@shikijs\/core/);
	assert.match(readFileSync(join(notices, "OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE/);
	assert.match(readFileSync(join(notices, "OFL.txt"), "utf8"), /JetBrains/);
	assert.match(readFileSync(join(notices, "icons-LICENSE"), "utf8"), /MIT License/);
	assert.match(readFileSync(join(notices, "icons-LICENSE"), "utf8"), /Copyright/);
	assert.match(readFileSync(join(notices, "icons-SOURCE.txt"), "utf8"), /Material Icon Theme/);
	assert.match(readFileSync(join(notices, "icons-SOURCE.txt"), "utf8"), /[0-9a-f]{40}/);

	assert.equal(existsSync(join(installed, "dist/protocol")), false);
	assert.match(
		readFileSync(join(installed, "dist/server/src/components/http-api/internal/wire.d.ts"), "utf8"),
		/api-contract\/index\.ts/,
	);
	assert.match(readFileSync(join(installed, "LICENSE"), "utf8"), /MIT License/);
	assert.ok(
		packed[0].files.every((file: { path: string }) => /^(dist\/|package.json$|README.md$|LICENSE$)/.test(file.path)),
	);
	assert.equal(Object.hasOwn(installedManifest.exports, "./workspace"), false);
	writeFileSync(
		join(consumer, "removed-export.ts"),
		`// @ts-expect-error The executable-policy authoring export is removed.
import type { WorkspacePolicy } from '@zdreamer/forge/workspace';
export type Removed = WorkspacePolicy;
`,
	);
	// Check the UI-facing source seam in the actual artifact, not as a new npm export.
	writeFileSync(
		join(consumer, "api-contract.ts"),
		`import type { ApiErrorCode, ApiFailure, WorkspaceChanges, WorkspaceIdentity, FileBaseline, FileSide, FileUnsupportedReason, WorkspaceFileDiff } from './node_modules/@zdreamer/forge/dist/server/src/components/api-contract/index.js';
export const changes = {codebases: {app: {id: 'service-guide', root: 'app', guidance: 'docs/app'}}, changes: []} satisfies WorkspaceChanges;
// @ts-expect-error Concrete definitions require their root.
export const missingRoot: WorkspaceChanges = {codebases: {app: {guidance: 'docs/app'}}, changes: []};
// @ts-expect-error Every definition requires stable identity.
export const missingId: WorkspaceChanges = {codebases: {app: {root: 'app', guidance: 'docs/app'}}, changes: []};
// @ts-expect-error Legacy type is unsupported.
export const legacyType: WorkspaceChanges = {codebases: {app: {id: 'service-guide', root: 'app', guidance: 'docs/app', type: 'service'}}, changes: []};
export const identity = {workspace: {root: '/example', name: 'Example'}, repositories: []} satisfies WorkspaceIdentity;
export const error = 'not_found' satisfies ApiErrorCode;
export const invalidRequest = 'invalid_request' satisfies ApiErrorCode;
export const baseline = {kind: 'commit', oid: '0123456789012345678901234567890123456789'} satisfies FileBaseline;
export const unborn = {kind: 'unborn'} satisfies FileBaseline;
export const fileSide = {path: 'app/file.txt', kind: 'file', mode: '100644', present: true, codebase: 'app'} satisfies FileSide;
export const unsupportedReasons = ['binary', 'encoding', 'too_large'] satisfies FileUnsupportedReason[];
const fileChange = {path: 'app/file.txt', repo: '.', baseline, context: 3 as const, changeKind: 'modified' as const, base: fileSide, current: fileSide, statistics: {added: 1, removed: 1, binary: false}, codebases: {}};
export const diffResults = [
  {...fileChange, kind: 'text', patch: 'patch'},
  {...fileChange, kind: 'text', patch: 'full patch', context: 'all'},
  {...fileChange, kind: 'metadata_only'},
  {...fileChange, kind: 'unsupported', reason: 'binary'},
  {kind: 'not_changed', codebases: {}},
] satisfies WorkspaceFileDiff[];
// @ts-expect-error Text patches require their complete patch payload.
export const missingPatch: WorkspaceFileDiff = {...fileChange, kind: 'text'};
// @ts-expect-error Only bounded or complete context is supported.
export const invalidContext: WorkspaceFileDiff = {...fileChange, kind: 'text', patch: 'patch', context: 4};
export const failure = {error: {code: 'internal_error', message: 'Internal server error', handler: 'workspace:1'}} satisfies ApiFailure;
// @ts-expect-error Node globals must not leak through the browser-safe contract.
export type NodeGlobal = typeof process;
`,
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2024",
				lib: ["ES2024"],
				module: "NodeNext",
				types: [],
			},
			include: ["removed-export.ts", "api-contract.ts"],
		}),
	);
	const compiler = join(root, "node_modules/.bin/tsc");
	run(compiler, ["--project", consumer], consumer);
	const executable = join(consumer, "node_modules/.bin/forge");
	const removedCommand = spawnSync(executable, ["inspect-workspace", "workspace.ts", ".", "example.ts"], {
		cwd: consumer,
		encoding: "utf8",
		timeout: 10_000,
	});
	assert.equal(removedCommand.status, 1);
	assert.match(removedCommand.stderr, /Usage: forge serve/);
	verifyInvalidStartup(executable, consumer);
	await verifyServer(executable, consumer);
	await verifyInstalledAnalysis({
		consumer,
		executable,
		compiler,
		run,
		portReservation,
		installedServer,
		sourceState,
		generatedBaseGuide,
	});
	await verifyInstalledFiles({ consumer, executable, run, portReservation, installedServer, sourceState });
	if (artifactDirectory) {
		mkdirSync(artifactDirectory, { recursive: true });
		copyFileSync(join(temporary, packed[0].filename), join(artifactDirectory, packed[0].filename));
		writeFileSync(join(artifactDirectory, "pack.json"), `${JSON.stringify(packed, null, 2)}\n`);
	}
	console.log(
		"Tarball-only consumer: installed server/React/CSS/Chromium, read-only changes/analysis/files, normalized patches and full context, guide extensions and native TS imports, rename warnings, restart/failure isolation, protection, shutdown and contract boundaries passed.",
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
