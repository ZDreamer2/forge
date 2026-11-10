import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import type { WorkspaceAnalysis, WorkspaceFileDiff } from "../../components/api-contract/index.ts";
import { createTreeAnalyzer } from "../../components/tree-analysis/index.ts";
import { createWorkingChanges } from "../../components/tree-sources/index.ts";
import type { RepositoryResolution } from "../../components/workspace-repositories/index.ts";
import { createGitProcess, type GitProcess } from "../../lib/git/index.ts";
import { createAnalysis } from "../analysis.ts";
import { createCollection } from "../collection.ts";
import { createFileRequests } from "../file-requests.ts";
import { createHttpApp } from "../http.ts";
import { createRequestRuns } from "../request-runs.ts";

const env = {
	PATH: "/usr/bin:/bin",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function isAdditionStatistics(args: readonly string[], path: string) {
	return args.includes("--no-index") && args.includes("--numstat") && args.at(-1)?.endsWith(`/${path}`);
}

async function fixture(t: TestContext, decorate: (git: GitProcess) => GitProcess, timeoutMs?: number) {
	const root = await mkdtemp(join(tmpdir(), "forge-discovery-http-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { env });
	git("init", "-q", "--initial-branch=main");
	await writeFile(join(root, "ordinary.txt"), "before\n");
	git("add", "--all");
	git("commit", "-qm", "fixture");
	await writeFile(join(root, "ordinary.txt"), "after\n");
	await writeFile(join(root, "selected.txt"), "selected\n");
	await writeFile(join(root, "unrelated.txt"), "unrelated\nsecond\n");
	const repositories: readonly RepositoryResolution[] = [{ path: ".", status: "available", gitRoot: root }];
	const source = createWorkingChanges({ root, repositories, codebases: [], git: decorate(createGitProcess(env)) });
	const collection = createCollection({ collect: source.discover });
	const analysis = createAnalysis({ timeoutMs });
	const fileRequests = createFileRequests({ timeoutMs });
	const changesRequests = createRequestRuns({ operation: "Workspace changes", timeoutMs });
	const close = () =>
		Promise.all([analysis.close(), fileRequests.close(), changesRequests.close(), collection.close()]);
	t.after(async () => {
		await close();
		await rm(root, { recursive: true, force: true });
	});
	const app = createHttpApp({
		guidance: { workspace: [], codebases: {} },
		root,
		name: "Fixture",
		repositories,
		port: 43210,
		discoverChanges: collection.collect,
		materializeChanges: source.materialize,
		fileDiff: source.fileDiff,
		currentByteSize: source.currentByteSize,
		analysis,
		fileRequests,
		changesRequests,
		analyze: createTreeAnalyzer({
			config: { workspace: { guide: "/guide", parents: [] }, guides: [], repositories: [], unavailable: [] },
			extensions: [],
		}).analyze,
	});
	return {
		root,
		close,
		request: async (path: string, signal?: AbortSignal) =>
			app.request(`/api/changes${path}`, { headers: { host: "127.0.0.1:43210" }, signal }),
	};
}

test("overlapping files and analysis share only live discovery and cancelling one file leaves peers independent", async (t) => {
	const discoveryStarted = Promise.withResolvers<void>();
	const discoveryRelease = Promise.withResolvers<void>();
	const statisticsStarted = Promise.withResolvers<void>();
	const statisticsRelease = Promise.withResolvers<void>();
	t.after(() => {
		discoveryRelease.resolve();
		statisticsRelease.resolve();
	});
	let discoveryCount = 0;
	let discoverySignal: AbortSignal | undefined;
	const service = await fixture(t, (git) => async (root, args, options) => {
		if (args[0] === "ls-files" && args.includes("--unmerged")) {
			discoveryCount++;
			if (discoveryCount === 1) {
				discoverySignal = options?.signal;
				discoveryStarted.resolve();
				await discoveryRelease.promise;
			}
		}
		if (isAdditionStatistics(args, "unrelated.txt")) {
			statisticsStarted.resolve();
			await statisticsRelease.promise;
		}
		return git(root, args, options);
	});
	const client = new AbortController();
	const analysis = service.request("/analysis");
	const cancelled = service.request("/file?path=ordinary.txt", client.signal);
	const ordinary = service.request("/file?path=ordinary.txt");
	const selected = service.request("/file?path=selected.txt");
	await discoveryStarted.promise;
	client.abort(new Error("disconnected"));
	assert.equal((await cancelled).status, 500);
	assert.equal(discoverySignal?.aborted, false, "another client still owns shared discovery");
	discoveryRelease.resolve();
	await statisticsStarted.promise;
	assert.equal((await ordinary).status, 200);
	const selectedResponse = await selected;
	assert.equal(selectedResponse.status, 200);
	assert.equal(
		((await selectedResponse.json()) as Extract<WorkspaceFileDiff, { kind: "text" }>).patch.includes("+selected"),
		true,
	);
	let analyzed = false;
	void analysis.then(() => {
		analyzed = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(analyzed, false, "files do not wait for analysis's unrelated statistics");
	assert.equal(discoveryCount, 1);
	statisticsRelease.resolve();
	const response = await analysis;
	assert.equal(response.status, 200);
	const result = (await response.json()) as WorkspaceAnalysis;
	assert.deepEqual(result.nodes["."]?.rawTotals, { added: 4, removed: 1 });
	assert.deepEqual(result.nodes["unrelated.txt"]?.statistics, { added: 2, removed: 0, binary: false });
	await writeFile(join(service.root, "ordinary.txt"), "fresh revisit\n");
	const revisit = await service.request("/file?path=ordinary.txt");
	assert.equal(revisit.status, 200);
	assert.equal(
		((await revisit.json()) as Extract<WorkspaceFileDiff, { kind: "text" }>).patch.includes("+fresh revisit"),
		true,
	);
	assert.equal(discoveryCount, 2, "a settled observation is never reused");
});

test("file statistics failures are operation-scoped while analysis and changes still materialize every entry", async (t) => {
	let unrelatedStatistics = 0;
	let failDiscovery = false;
	const service = await fixture(t, (git) => async (root, args, options) => {
		if (failDiscovery && args[0] === "ls-files" && args.includes("--unmerged"))
			throw new Error("fresh discovery failed");
		if (isAdditionStatistics(args, "unrelated.txt")) {
			unrelatedStatistics++;
			throw new Error("unrelated statistics failed");
		}
		return git(root, args, options);
	});
	const ordinary = await service.request("/file?path=ordinary.txt");
	assert.equal(ordinary.status, 200);
	assert.match(((await ordinary.json()) as Extract<WorkspaceFileDiff, { kind: "text" }>).patch, /\+after/);
	assert.equal(unrelatedStatistics, 0, "the ordinary file does not validate unrelated statistics");
	for (const path of ["/file?path=unrelated.txt", "/analysis", ""]) {
		const failed = await service.request(path);
		assert.equal(failed.status, 500, path);
		assert.deepEqual(await failed.json(), { error: { code: "internal_error", message: "Internal server error" } });
	}
	assert.equal(unrelatedStatistics, 3);
	failDiscovery = true;
	for (const path of ["/file?path=ordinary.txt", "/file?path=unknown.txt", "/analysis", ""]) {
		assert.equal((await service.request(path)).status, 500, "fresh discovery failures stay authoritative");
	}
	assert.equal(unrelatedStatistics, 3, "discovery fails before any statistics projection starts");
});

for (const operation of ["file", "analysis", "changes"] as const) {
	test(`${operation} request budget aborts and shutdown drains its last owned statistics command`, async (t) => {
		const started = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		const reaped = Promise.withResolvers<void>();
		t.after(() => reaped.resolve());
		let statisticsSignal: AbortSignal | undefined;
		const service = await fixture(
			t,
			(git) => async (root, args, options) => {
				if (isAdditionStatistics(args, "selected.txt")) {
					statisticsSignal = options?.signal;
					statisticsSignal?.addEventListener("abort", () => aborted.resolve(), { once: true });
					started.resolve();
					await reaped.promise;
					statisticsSignal?.throwIfAborted();
				}
				return git(root, args, options);
			},
			2000,
		);
		const path = operation === "file" ? "/file?path=selected.txt" : operation === "analysis" ? "/analysis" : "";
		let settled = false;
		const pending = service.request(path).then((response) => {
			settled = true;
			return response;
		});
		await started.promise;
		await aborted.promise;
		assert.equal(statisticsSignal?.aborted, true);
		let closed = false;
		const closing = service.close().then(() => {
			closed = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false, "the timed-out request still drains its source statistics");
		assert.equal(closed, false, "shutdown retains ownership until the command is reaped");
		reaped.resolve();
		assert.equal((await pending).status, 500);
		await closing;
		assert.equal(closed, true);
		assert.equal((await service.request(path)).status, 500, "shutdown stops request admission");
	});
}
