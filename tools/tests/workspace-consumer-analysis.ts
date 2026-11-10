import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
	AnalysisWireNode,
	ApiFailure,
	WorkspaceAnalysis,
} from "../../server/src/components/api-contract/index.ts";

function requiredNode(result: WorkspaceAnalysis, path: string): AnalysisWireNode {
	const node = result.nodes[path];
	assert.ok(node, `Missing analysis node ${path}`);
	return node;
}

interface Server {
	address: string;
	stop(signal: NodeJS.Signals): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	stderr(): string;
}
interface Deps {
	consumer: string;
	executable: string;
	compiler: string;
	run(command: string, args: string[], cwd: string): string;
	portReservation(port?: number): Promise<{ port: number; close(): Promise<void> }>;
	installedServer(executable: string, cwd: string, workspace: string, port: number): Promise<Server>;
	sourceState(workspace: string): unknown;
	generatedBaseGuide?: string;
}

export async function verifyInstalledAnalysis({
	consumer,
	executable,
	compiler,
	run,
	portReservation,
	installedServer,
	sourceState,
	generatedBaseGuide,
}: Deps) {
	const workspace = join(consumer, "analysis-fixture");
	function write(path: string, content: string) {
		mkdirSync(dirname(join(workspace, path)), { recursive: true });
		writeFileSync(join(workspace, path), content);
	}
	const marker = "docs/forge/workspace/forge-workspace.yaml";
	const workspaceYaml = `repositories: [., nested]\nparents: [forge-base]\ncodebases: [../../../owner/forge-codebase.yaml, ../../../other/forge-codebase.yaml, ../../../reusable/forge-codebase.yaml, ../../../base/forge-codebase.yaml, ../../../unused/forge-codebase.yaml]\n`;
	write(marker, workspaceYaml);
	write("owner/forge-codebase.yaml", "id: foreign-guide\nroot: ../tests\nparents: [reusable-guide]\n");
	write("other/forge-codebase.yaml", "id: other-guide\nroot: ../other-files\nparents: [reusable-guide]\n");
	write("reusable/forge-codebase.yaml", "id: reusable-guide\n");
	write("unused/forge-codebase.yaml", "id: unused-guide\n");
	write(
		"unused/forge-extension/forge-extension.ts",
		"throw new Error('unadopted rootless extension must not load');\n",
	);
	write("base/forge-codebase.yaml", "id: forge-base\n");
	write(
		"base/forge-extension/forge-extension.ts",
		`import type { ForgeExtension } from '@zdreamer/forge/extension';
export default {
  api: 1,
  classifyNode(ctx) {
    if (/\\.(md|markdown)$/i.test(ctx.node.path)) ctx.classify('docs');
    if (/\\.json$/i.test(ctx.node.path)) ctx.classify('config');
    if (/\\.woff2$/i.test(ctx.node.path)) ctx.classify('assets');
    const directory = ctx.node.base?.kind === 'directory' || ctx.node.current?.kind === 'directory';
    if (ctx.node.path.split('/').slice(0, directory ? undefined : -1).some(part => /^(test|tests|__tests__)$/i.test(part))) ctx.classify('tests');
  },
  async annotateNode(ctx) {
    const node = ctx.node;
    if (node.base?.kind === 'directory' || node.current?.kind === 'directory') {
      const name = node.path.split('/').at(-1);
      if (node.path === 'plans' || name === 'tests' || name === 'Tests') node.deemphasize('Fixture directory policy');
    }
    if (node.current?.kind === 'file' && (node.kind === 'added' || node.kind === 'modified' || (node.kind === 'renamed' && node.renameContentChanged)) && /\\.(md|markdown)$/i.test(node.path) && !node.path.startsWith('plans/') && await ctx.source.currentByteSize(node) > 20480) node.warn('Fixture Markdown policy');
  },
} satisfies ForgeExtension;
`,
	);
	if (generatedBaseGuide) {
		cpSync(generatedBaseGuide, join(workspace, "base"), { recursive: true });
		const generatedEntry = join(generatedBaseGuide, "forge-extension/forge-extension.ts");
		assert.deepEqual(
			readFileSync(join(workspace, "base/forge-extension/forge-extension.ts")),
			readFileSync(generatedEntry),
		);
		const local = "base/forge-extension/tests/fixtures/local-guide";
		write(
			marker,
			workspaceYaml
				.replace("parents: [forge-base]", "parents: [forge-base, distributed-local-import]")
				.replace("codebases: [", `codebases: [../../../${local}/forge-codebase.yaml, `),
		);
		run(process.execPath, ["--test", join(workspace, "base/forge-extension/tests/forge-extension.test.ts")], consumer);
	}
	write(".gitignore", "nested/\n");
	write("nested/file.txt", "baseline\n");
	const text = Array.from({ length: 500 }, (_, i) => `Markdown line ${i}: ${"x".repeat(45)}\n`).join("");
	for (const name of ["pure.md", "edited.md", "into.md", "plans/out.md"]) write(name, text);
	write("deleted.md", "Unique deleted document\n");
	write("deleted.css", "deleted stylesheet baseline\n");
	write("before.css", "rename out of low suffix\n");
	write("before.txt", "rename into low suffix\n");
	write("tests/critical/file.md", "baseline\n");
	write("tests/other.md", "baseline\n");
	const modulePath = "docs/forge/workspace/forge-extension/forge-extension.ts";
	const handler = () => `import type { ForgeExtension } from '@zdreamer/forge/extension';
import { message } from './internal/message.ts';
export default {
  api: 1,
  classifyNode(ctx) {
    if (ctx.node.path === 'boundary.md') ctx.classify('code', 'Explicit workspace override');
  },
  annotateNode(ctx) {
    if (ctx.node.path === '.') {
      const descendant = [...ctx.node.walk()].find(node => node.path === 'tests/other.md');
      if (descendant?.classification.value !== 'tests') throw new Error('classification must finish before root annotation');
    }
    if (ctx.guide.id !== 'workspace') throw new Error('namespaced workspace identity required');
    if (ctx.node.path === 'tests/critical') ctx.node.restoreNormalEmphasis('Review critical tests');
    if (ctx.node.path === 'tests/critical/file.md') ctx.node.notice(message);
  },
} satisfies ForgeExtension;
`;
	write("docs/forge/workspace/forge-extension/internal/message.ts", "export const message = 'startup-original';\n");
	write(modulePath, handler());
	write(
		"reusable/forge-extension/forge-extension.ts",
		`import type { ForgeExtension } from '@zdreamer/forge/extension';
export default {
  api: 1,
  classifyNode(ctx) { if (ctx.node.path === 'other-files/moved.md') ctx.classify('config', 'Shared parent assignment'); },
  annotateNode(ctx) { if (ctx.node.path === 'other-files/moved.md') ctx.node.notice('shared-parent'); },
} satisfies ForgeExtension;
`,
	);
	for (const [guide, id] of [
		["owner", "foreign-guide"],
		["other", "other-guide"],
	]) {
		write(
			`${guide}/forge-extension/forge-extension.ts`,
			`import type { ForgeExtension } from '@zdreamer/forge/extension';
export default {
  api: 1,
  classifyNode(ctx) {
    if (ctx.node.path === 'other-files/moved.md') {
      if (ctx.node.from !== 'tests/cross.md') throw new Error('Canonical rename target required');
      ctx.classify('${id === "foreign-guide" ? "tests" : "assets"}', '${id} assignment');
    }
  },
  annotateNode(ctx) {
    if (ctx.guide.id !== 'codebase:${id}') throw new Error('namespaced guide identity required');
    if (ctx.node.path === 'tests/critical/file.md') {
      if (!ctx.node.signals.some(signal => signal.message === 'startup-original' || signal.message === 'restart-new')) throw new Error('workspace hook must finish first');
      ctx.node.notice('foreign-owner-handler');
    }
    if (ctx.node.path === 'other-files/moved.md') ctx.node.notice('${id}');
  },
} satisfies ForgeExtension;
`,
		);
	}
	write("tests/cross.md", "cross-owner rename\n");
	mkdirSync(join(workspace, "other-files"), { recursive: true });
	for (const repository of [workspace, join(workspace, "nested")]) {
		run("git", ["init", "-q", repository], consumer);
		run("git", ["add", "."], repository);
		run(
			"git",
			["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"],
			repository,
		);
	}
	for (const [from, to, edit] of [
		["pure.md", "moved.md", false],
		["edited.md", "edited-new.md", true],
		["into.md", "plans/into-new.md", true],
		["plans/out.md", "out-new.md", true],
	] as const) {
		mkdirSync(dirname(join(workspace, to)), { recursive: true });
		renameSync(join(workspace, from), join(workspace, to));
		if (edit) write(to, `${text}edited\n`);
		run("git", ["add", from, to], workspace);
	}
	renameSync(join(workspace, "tests/cross.md"), join(workspace, "other-files/moved.md"));
	run("git", ["add", "tests/cross.md", "other-files/moved.md"], workspace);
	write("tests/critical/file.md", text);
	write("tests/other.md", text);
	unlinkSync(join(workspace, "deleted.md"));
	unlinkSync(join(workspace, "deleted.css"));
	write("deleted.css/child.php", "suffix transition child\n");
	for (const [from, to] of [
		["before.css", "after.txt"],
		["before.txt", "after.css"],
	] as const) {
		renameSync(join(workspace, from), join(workspace, to));
		run("git", ["add", from, to], workspace);
	}
	for (const path of [
		"style.css",
		"template.phtml",
		"view.blade.php",
		"upper.CSS",
		"near.css.ts",
		"view.blade.php.txt",
		"theme.css/ordinary.php",
	])
		write(path, "suffix policy fixture\n");
	write("settings.JSON", "{}\n");
	write("logo.WOFF2", "fixture font\n");
	write("boundary.md", "x".repeat(20_480));
	write("large.MARKDOWN", "x".repeat(20_481));
	write("plans/ignored.md", text);
	write("nested-plans/plans/eligible.md", text);
	write("__proto__/file.txt", "special key\n");
	writeFileSync(
		join(consumer, "extension-authoring.ts"),
		`import type {
  AnalysisNode, ForgeExtension, TreeAnnotationContext, TreeAnnotationHook, TreeSourceFacts,
  TreeClassificationContext, TreeClassificationHook,
} from '@zdreamer/forge/extension';
// @ts-expect-error Operational factories are private.
import type { createTreeAnalyzer } from '@zdreamer/forge/extension';
// @ts-expect-error Startup module loading is private.
import type { loadGuideExtensions } from '@zdreamer/forge/extension';
// @ts-expect-error The legacy authoring subpath is removed.
import type { AnalysisHandler } from '@zdreamer/forge/analysis';
// @ts-expect-error Engine configuration is private.
import type { WorkspaceConfig } from '@zdreamer/forge/extension';
// @ts-expect-error Package internals are not public subpaths.
import type { ForgeExtension as PrivateExtension } from '@zdreamer/forge/dist/server/src/components/guide-extensions/internal/authoring.js';
export default {
  api: 1,
  classifyNode(context: TreeClassificationContext) {
    const guide: 'workspace' | \`codebase:\${string}\` = context.guide.id;
    context.classify('code', guide);
    context.classify('tests');
    context.classify('docs');
    context.classify('config');
    context.classify('assets');
    context.signal.throwIfAborted();
    // @ts-expect-error Categories are a closed vocabulary.
    context.classify('documentation');
    // @ts-expect-error Classifiers cannot mutate canonical facts.
    context.node.path = 'changed';
    // @ts-expect-error Classifiers have no tree navigation.
    context.node.parent;
    // @ts-expect-error Classifiers have no source observation.
    context.source;
    // @ts-expect-error Classifiers cannot annotate.
    context.node.warn('wrong phase');
  },
  async annotateNode(context: TreeAnnotationContext) {
    const guide: 'workspace' | \`codebase:\${string}\` = context.guide.id;
    const node: AnalysisNode = context.node;
    const source: TreeSourceFacts = context.source;
    if (node.current?.kind === 'file') await source.currentByteSize(node);
    context.signal.throwIfAborted();
    node.notice(guide);
    const category: 'code' | 'tests' | 'docs' | 'config' | 'assets' = node.classification.value;
    node.parent?.notice(category);
    // @ts-expect-error Annotations cannot assign classifications.
    context.classify('code');
    // @ts-expect-error Annotations cannot replace classifications.
    node.classification = { value: 'code' };
    // @ts-expect-error Classification observations are readonly.
    node.classification.value = 'code';
    // Whole-tree navigation and cross-node annotation remain available.
    node.parent?.notice('Folder policy derived from a child');
    for (const descendant of node.walk()) descendant.notice('Subtree policy');
    // @ts-expect-error Guide IDs are namespaced, not raw codebase IDs.
    const rawGuide: 'forge-base' = context.guide.id;
    // @ts-expect-error The former whole-tree root is replaced by the current node.
    context.root;
    // @ts-expect-error Context properties cannot be replaced.
    context.node = node;
    // @ts-expect-error Annotation hooks have no execution capability.
    context.exec('command');
  },
} satisfies ForgeExtension;
export const standaloneClassifier: TreeClassificationHook = context => {
  context.classify('code');
  // @ts-expect-error Classifier context inference is not any.
  context.nonexistent;
};
export const standaloneHook: TreeAnnotationHook = context => {
  // @ts-expect-error Context inference is not any.
  context.nonexistent;
};
export const inferredContext = {
  api: 1,
  classifyNode(context) {
    const explicit: TreeClassificationContext = context;
    explicit.classify('docs');
    // @ts-expect-error Aggregate contract infers the classifier context.
    context.nonexistent;
  },
  annotateNode(context) {
    const explicit: TreeAnnotationContext = context;
    // @ts-expect-error Aggregate contract also provides a concrete context.
    context.nonexistent;
    explicit.node.notice('Inferred context');
  },
} satisfies ForgeExtension;
export const unsupportedRevision = {
  // @ts-expect-error Only the published revision is accepted.
  api: 2,
} satisfies ForgeExtension;
export const unknownHook = {
  api: 1,
  // @ts-expect-error Hooks unknown to this contract are rejected.
  checkDiff() {},
} satisfies ForgeExtension;
`,
	);
	writeFileSync(
		join(consumer, "tsconfig.analysis.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2024",
				lib: ["ES2024", "DOM"],
				module: "NodeNext",
				types: [],
				allowImportingTsExtensions: true,
			},
			include: [
				"extension-authoring.ts",
				"analysis-fixture/**/forge-extension/forge-extension.ts",
				"analysis-fixture/**/forge-extension/internal/*.ts",
			],
			exclude: ["analysis-fixture/**/tests/**"],
		}),
	);
	run(compiler, ["-p", join(consumer, "tsconfig.analysis.json")], consumer);
	run(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import assert from 'node:assert/strict';
assert.deepEqual(Object.keys(await import('@zdreamer/forge/extension')), []);
await assert.rejects(import('@zdreamer/forge/dist/server/src/components/tree-analysis/index.js'), {code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'});
`,
		],
		consumer,
	);
	const reservation = await portReservation();
	await reservation.close();
	let server = await installedServer(executable, consumer, workspace, reservation.port);
	const request = (path: string, init: RequestInit = {}) =>
		fetch(`${server.address}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
	try {
		const before = sourceState(workspace);
		const response = await request("/api/changes/analysis");
		assert.equal(response.status, 200, await response.clone().text());
		const result = (await response.json()) as WorkspaceAnalysis;
		assert.equal(result.root, ".");
		assert.deepEqual(result.codebases, {
			tests: { id: "foreign-guide", root: "tests", guidance: "owner" },
			"other-files": { id: "other-guide", root: "other-files", guidance: "other" },
		});
		assert.equal(result.guidance.workspace.at(-1)?.id, "workspace");
		assert.equal(result.guidance.workspace.at(-1)?.root, ".");
		assert.equal(result.guidance.workspace.at(-1)?.guidance, "docs/forge/workspace");
		assert.equal(result.guidance.workspace.at(-1)?.source, "workspace");
		assert.equal(result.guidance.workspace[0]?.id, "codebase:forge-base");
		assert.equal(result.guidance.workspace[0]?.source, "workspace-parent");
		assert.equal(Object.hasOwn(result.guidance.workspace[0] ?? {}, "root"), false);
		for (const [root, id, directory] of [
			["tests", "foreign-guide", "owner"],
			["other-files", "other-guide", "other"],
		] as const) {
			const chain = result.guidance.codebases[root];
			assert.ok(chain);
			assert.equal(new Set(chain.map((guide) => guide.id)).size, chain.length, "Shared guides appear once");
			assert.deepEqual(chain.at(-1), {
				id: `codebase:${id}`,
				name: id,
				root,
				guidance: directory,
				source: "project-folder",
			});
			const reusable = chain.find((guide) => guide.id === "codebase:reusable-guide");
			assert.deepEqual(reusable, {
				id: "codebase:reusable-guide",
				name: "reusable-guide",
				guidance: "reusable",
				source: "project-parent",
			});
			assert.ok(chain.findIndex((guide) => guide.id === "workspace") < chain.indexOf(reusable));
		}
		assert.ok(result.handlers["workspace#classifyNode"]);
		assert.ok(result.handlers["codebase:forge-base#classifyNode"]);
		assert.deepEqual(requiredNode(result, ".").classification, { value: "code" });
		for (const [path, value] of [
			["tests", "tests"],
			["tests/other.md", "tests"],
			["moved.md", "docs"],
			["deleted.md", "docs"],
			["settings.JSON", "config"],
			["logo.WOFF2", "assets"],
		] as const) {
			const classification = requiredNode(result, path).classification;
			assert.equal(classification.value, value, path);
			assert.ok(classification.handler);
			assert.equal(result.handlers[classification.handler]?.id, "codebase:forge-base#classifyNode");
		}
		assert.deepEqual(requiredNode(result, "boundary.md").classification, {
			value: "code",
			reason: "Explicit workspace override",
			handler: "workspace#classifyNode",
		});
		const renamed = requiredNode(result, "other-files/moved.md");
		assert.equal(renamed.base?.codebase, "tests");
		assert.equal(renamed.current?.codebase, "other-files");
		assert.deepEqual(renamed.classification, {
			value: "assets",
			reason: "other-guide assignment",
			handler: "codebase:other-guide#classifyNode",
		});
		const identities = Object.keys(result.handlers);
		const firstAnnotation = identities.findIndex((id) => id.endsWith("#annotateNode"));
		assert.ok(firstAnnotation > 0);
		assert.ok(identities.slice(0, firstAnnotation).every((id) => id.endsWith("#classifyNode")));
		assert.ok(identities.slice(firstAnnotation).every((id) => id.endsWith("#annotateNode")));
		assert.ok(result.handlers["workspace#annotateNode"]);
		assert.ok(result.handlers["codebase:forge-base#annotateNode"]);
		for (const identity of Object.values(result.handlers)) assert.equal(Object.hasOwn(identity, "codebase"), false);
		assert.deepEqual(
			requiredNode(result, "other-files/moved.md").signals.map((signal) => signal.message),
			["shared-parent", "foreign-guide", "other-guide"],
		);
		if (generatedBaseGuide)
			assert.ok(
				requiredNode(result, ".").signals.some((signal) => signal.message === "generated local TypeScript import"),
			);
		if (generatedBaseGuide) {
			for (const path of ["style.css", "template.phtml", "view.blade.php", "deleted.css", "after.css"]) {
				const node = requiredNode(result, path);
				assert.equal(node.effectiveEmphasis.value, "deemphasized", path);
				assert.equal(node.effectiveEmphasis.handler, "codebase:forge-base#annotateNode", path);
			}
			for (const path of ["upper.CSS", "near.css.ts", "view.blade.php.txt", "after.txt", "theme.css/ordinary.php"])
				assert.equal(requiredNode(result, path).effectiveEmphasis.value, "normal", path);
			assert.equal(requiredNode(result, "deleted.css/child.php").effectiveEmphasis.value, "deemphasized");
		}
		const nodes = result.nodes;
		assert.ok(Object.hasOwn(nodes, "__proto__"));
		assert.equal(requiredNode(result, "edited-new.md").renameContentChanged, true);
		assert.equal(requiredNode(result, "moved.md").renameContentChanged, false);
		const warnings = (path: string) =>
			requiredNode(result, path).signals.filter((item: { severity: string }) => item.severity === "warning");
		for (const path of [
			"edited-new.md",
			"out-new.md",
			"tests/critical/file.md",
			"tests/other.md",
			"large.MARKDOWN",
			"nested-plans/plans/eligible.md",
		])
			assert.equal(warnings(path).length, 1, path);
		for (const path of ["moved.md", "plans/into-new.md", "plans/ignored.md", "boundary.md"])
			assert.equal(warnings(path).length, 0, path);
		assert.equal(requiredNode(result, "tests/critical/file.md").effectiveEmphasis.value, "normal");
		assert.equal(requiredNode(result, "tests/other.md").effectiveEmphasis.value, "deemphasized");
		assert.deepEqual(
			requiredNode(result, "tests/critical/file.md")
				.signals.map((item: { message: string }) => item.message)
				.slice(-2),
			["startup-original", "foreign-owner-handler"],
		);
		assert.deepEqual(sourceState(workspace), before);
		for (const path of ["/api/changes/analysis"]) {
			assert.equal((await request(path, { headers: { origin: "https://foreign.invalid" } })).status, 403);
			assert.equal((await request(path, { method: "POST" })).status, 405);
			const head = await request(path, { method: "HEAD" });
			assert.equal(head.status, 200);
			assert.equal(await head.text(), "");
		}
		write("docs/forge/workspace/forge-extension/internal/message.ts", "export const message = 'restart-new';\n");
		write(modulePath, handler());
		const cached = (await (await request("/api/changes/analysis")).json()) as WorkspaceAnalysis;
		assert.ok(
			requiredNode(cached, "tests/critical/file.md").signals.some(
				(s: { message: string }) => s.message === "startup-original",
			),
		);
		assert.deepEqual(await server.stop("SIGTERM"), { code: 0, signal: null }, server.stderr());
		server = await installedServer(executable, consumer, workspace, reservation.port);
		const restarted = (await (await request("/api/changes/analysis")).json()) as WorkspaceAnalysis;
		assert.ok(
			requiredNode(restarted, "tests/critical/file.md").signals.some(
				(s: { message: string }) => s.message === "restart-new",
			),
		);
		write(
			modulePath,
			"export default {api: 1, annotateNode() { throw new Error('/private/secret handler failure'); }};\n",
		);
		await server.stop("SIGTERM");
		server = await installedServer(executable, consumer, workspace, reservation.port);
		const beforeFailure = sourceState(workspace);
		const failure = await request("/api/changes/analysis");
		assert.equal(failure.status, 500);
		const envelope = (await failure.json()) as { error: { code: string; handler?: string } };
		assert.equal(envelope.error.code, "internal_error");
		assert.equal(envelope.error.handler, "workspace#annotateNode");
		assert.doesNotMatch(JSON.stringify(envelope), /private|secret|\.ts/);
		assert.equal((await request("/api/changes")).status, 200);
		assert.deepEqual(sourceState(workspace), beforeFailure);
		write(
			modulePath,
			"export default {api: 1, classifyNode() { throw new Error('/private/secret classifier failure'); }, annotateNode() { throw new Error('annotation must not run'); }};\n",
		);
		await server.stop("SIGTERM");
		server = await installedServer(executable, consumer, workspace, reservation.port);
		const beforeClassifierFailure = sourceState(workspace);
		const classifierFailure = await request("/api/changes/analysis");
		assert.equal(classifierFailure.status, 500);
		const classifierEnvelope = (await classifierFailure.json()) as ApiFailure;
		assert.equal(classifierEnvelope.error.code, "internal_error");
		assert.equal(classifierEnvelope.error.handler, "workspace#classifyNode");
		assert.doesNotMatch(JSON.stringify(classifierEnvelope), /private|secret|\.ts/);
		assert.equal((await request("/api/changes")).status, 200);
		assert.deepEqual(sourceState(workspace), beforeClassifierFailure);
		write(marker, "repositories: [., nested]\ncodebases: []\n");
		write(modulePath, "export default {api: 1};\n");
		await server.stop("SIGTERM");
		server = await installedServer(executable, consumer, workspace, reservation.port);
		const conventionFree = (await (await request("/api/changes/analysis")).json()) as WorkspaceAnalysis;
		assert.deepEqual(conventionFree.handlers, {});
		for (const node of Object.values(conventionFree.nodes)) assert.deepEqual(node.classification, { value: "code" });
		assert.equal(requiredNode(conventionFree, "tests/other.md").effectiveEmphasis.value, "normal");
		for (const path of ["style.css", "template.phtml", "view.blade.php", "deleted.css", "after.css"])
			assert.equal(requiredNode(conventionFree, path).effectiveEmphasis.value, "normal", path);
		assert.deepEqual(requiredNode(conventionFree, "large.MARKDOWN").signals, []);
		write(modulePath, "export default 123;\n");
		await server.stop("SIGTERM");
		server = await installedServer(executable, consumer, workspace, reservation.port);
		const loadFailure = await request("/api/changes/analysis");
		assert.equal(loadFailure.status, 500);
		assert.equal(((await loadFailure.json()) as ApiFailure).error.handler, "workspace#classifyNode");
		assert.equal((await request("/api/changes")).status, 200);
	} finally {
		await server.stop("SIGKILL");
	}
	const released = await portReservation(reservation.port);
	await released.close();
	assert.ok(readFileSync(join(workspace, modulePath), "utf8"));
}
