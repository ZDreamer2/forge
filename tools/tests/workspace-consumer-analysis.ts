import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AnalysisWireNode, WorkspaceAnalysis } from "../../server/src/components/api-contract/index.ts";

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
}

export async function verifyInstalledAnalysis({
	consumer,
	executable,
	compiler,
	run,
	portReservation,
	installedServer,
	sourceState,
}: Deps) {
	const workspace = join(consumer, "analysis-fixture");
	function write(path: string, content: string) {
		mkdirSync(dirname(join(workspace, path)), { recursive: true });
		writeFileSync(join(workspace, path), content);
	}
	const marker = "docs/forge/workspace/forge-workspace.yaml";
	const workspaceYaml = `repositories: [., nested]\ncodebases: [../../../owner/forge-codebase.yaml]\ncodebase_types: []\nanalysis_handlers: [./workspace.ts]\n`;
	write(marker, workspaceYaml);
	write("owner/forge-codebase.yaml", "root: .\nanalysis_handlers: [./codebase.ts]\n");
	write(".gitignore", "nested/\n");
	write("nested/file.txt", "baseline\n");
	const text = Array.from({ length: 500 }, (_, i) => `Markdown line ${i}: ${"x".repeat(45)}\n`).join("");
	for (const name of ["pure.md", "edited.md", "into.md", "plans/out.md"]) write(name, text);
	write("tests/critical/file.md", "baseline\n");
	write("tests/other.md", "baseline\n");
	const modulePath = "docs/forge/workspace/workspace.ts";
	const handler = (message: string) => `import type { AnalysisHandler } from '@zdreamer/forge/analysis';
const handler: AnalysisHandler = (root) => {
  for (const node of root.walk()) {
    if (node.path === 'tests/critical') node.restoreNormalEmphasis('Review critical tests');
    if (node.path === 'tests/critical/file.md') node.notice('${message}');
  }
};
export default handler;
`;
	write(modulePath, handler("startup-original"));
	write(
		"owner/codebase.ts",
		`import type { AnalysisHandler } from '@zdreamer/forge/analysis';
const handler: AnalysisHandler = (root) => {
  for (const node of root.walk()) {
    if (node.path === 'tests/critical/file.md') {
      if (!node.signals.some(signal => signal.message === 'startup-original' || signal.message === 'restart-new')) throw new Error('workspace handler must finish first');
      node.notice('foreign-owner-handler');
    }
  }
};
export default handler;
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
	write("tests/critical/file.md", text);
	write("tests/other.md", text);
	write("boundary.md", "x".repeat(20_480));
	write("large.MARKDOWN", "x".repeat(20_481));
	write("plans/ignored.md", text);
	write("nested-plans/plans/eligible.md", text);
	write("__proto__/file.txt", "special key\n");
	// The authoring program has server platform globals; the separate browser fixture remains Node-free.
	writeFileSync(
		join(consumer, "analysis-authoring.ts"),
		`import type { AnalysisHandler } from '@zdreamer/forge/analysis';
// @ts-expect-error Operational factories are private.
import type { createTreeAnalyzer } from '@zdreamer/forge/analysis';
// @ts-expect-error Startup module loading is private.
import type { loadAnalysisHandlers } from '@zdreamer/forge/analysis';
// @ts-expect-error Configuration records are private.
import type { WorkspaceConfig } from '@zdreamer/forge/analysis';
export const example: AnalysisHandler = root => {
  const signal: AbortSignal = root.signal;
  for (const node of root.walk()) {
    // @ts-expect-error Paths are immutable.
    node.path = 'changed';
    // @ts-expect-error Source statistics are immutable.
    if (node.statistics) node.statistics.added = 3;
    node.notice(signal.aborted ? 'cancelled' : 'ready', {side: 'current', line: 1});
  }
};
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
			include: ["analysis-authoring.ts", "analysis-fixture/**/*.ts"],
		}),
	);
	run(compiler, ["-p", join(consumer, "tsconfig.analysis.json")], consumer);
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
		write(modulePath, handler("restart-new"));
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
		write(modulePath, "export default () => { throw new Error('/private/secret handler failure'); };\n");
		await server.stop("SIGTERM");
		server = await installedServer(executable, consumer, workspace, reservation.port);
		const beforeFailure = sourceState(workspace);
		const failure = await request("/api/changes/analysis");
		assert.equal(failure.status, 500);
		const envelope = (await failure.json()) as { error: { code: string; handler?: string } };
		assert.equal(envelope.error.code, "internal_error");
		assert.ok(envelope.error.handler);
		assert.doesNotMatch(JSON.stringify(envelope), /private|secret|\.ts/);
		assert.equal((await request("/api/changes")).status, 200);
		assert.deepEqual(sourceState(workspace), beforeFailure);
		write(modulePath, "export default 123;\n");
		await server.stop("SIGTERM");
		server = await installedServer(executable, consumer, workspace, reservation.port);
		assert.equal((await request("/api/changes/analysis")).status, 500);
		assert.equal((await request("/api/changes")).status, 200);
	} finally {
		await server.stop("SIGKILL");
	}
	const released = await portReservation(reservation.port);
	await released.close();
	assert.ok(readFileSync(join(workspace, modulePath), "utf8"));
}
