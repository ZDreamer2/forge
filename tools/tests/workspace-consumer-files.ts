import assert from "node:assert/strict";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { WorkspaceFileDiff } from "../../server/src/components/api-contract/index.ts";

interface Server {
	address: string;
	stop(signal: NodeJS.Signals): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	stderr(): string;
}
interface Deps {
	consumer: string;
	executable: string;
	run(command: string, args: string[], cwd: string): string;
	portReservation(port?: number): Promise<{ port: number; close(): Promise<void> }>;
	installedServer(executable: string, cwd: string, workspace: string, port: number): Promise<Server>;
	sourceState(workspace: string): unknown;
}

export async function verifyInstalledFiles({
	consumer,
	executable,
	run,
	portReservation,
	installedServer,
	sourceState,
}: Deps) {
	const workspace = join(consumer, "files-fixture");
	function write(path: string, content: string | Buffer) {
		mkdirSync(dirname(join(workspace, path)), { recursive: true });
		writeFileSync(join(workspace, path), content);
	}
	write(
		"docs/forge/workspace/forge-workspace.yaml",
		"repositories: [., nested, missing]\ncodebases: [../../../owner/forge-codebase.yaml, ../../../nested/docs/forge-codebase.yaml]\ncodebase_types: []\nanalysis_handlers: [./handler.mjs]\n",
	);
	write(
		"docs/forge/workspace/handler.mjs",
		"export default () => { throw new Error('file requests must never run handlers'); };\n",
	);
	write("owner/forge-codebase.yaml", "root: ../app\n");
	write("nested/docs/forge-codebase.yaml", "root: ..\n");
	write(".gitignore", "nested/\n");
	write(".gitattributes", "*.txt text eol=crlf\n");
	write("app/normalized.txt", "old\r\n");
	write("app/source.txt", "rename original\r\n");
	const contextLines = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`);
	write("app/context.txt", `${contextLines.join("\r\n")}\r\n`);
	write("app/pure.md", "unchanged move\n");
	write("app/unchanged.txt", "unchanged\r\n");
	write("app/deleted.txt", "deleted\r\n");
	write("nested/binary.dat", Buffer.from([0, 1, 2]));
	for (const repository of [workspace, join(workspace, "nested")]) {
		run("git", ["init", "-q", repository], consumer);
		run("git", ["add", "."], repository);
		run(
			"git",
			["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline"],
			repository,
		);
	}
	write("app/normalized.txt", "\uFEFFnew\r\nlast");
	write(
		"app/context.txt",
		`${contextLines.map((line, index) => (index === 11 ? "changed middle" : line)).join("\r\n")}\r\n`,
	);
	rmSync(join(workspace, "app/deleted.txt"));
	mkdirSync(join(workspace, "other"));
	renameSync(join(workspace, "app/source.txt"), join(workspace, "other/destination.txt"));
	renameSync(join(workspace, "app/pure.md"), join(workspace, "other/moved.md"));
	run("git", ["add", "app/source.txt", "other/destination.txt", "app/pure.md", "other/moved.md"], workspace);
	write("app/source.txt", "recreated\r\n");
	write("app/empty.txt", "");
	write("nested/binary.dat", Buffer.from([0, 4, 5]));
	const literalPath = "app/tab\tline\n#%?é.txt";
	write(literalPath, "literal\n");
	const reservation = await portReservation();
	await reservation.close();
	const beforeStartup = sourceState(workspace);
	const server = await installedServer(executable, consumer, workspace, reservation.port);
	const request = (path: string, init: RequestInit = {}) =>
		fetch(`${server.address}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
	try {
		assert.deepEqual(sourceState(workspace), beforeStartup);
		const diff = async (path: string, context?: "3" | "all"): Promise<WorkspaceFileDiff> => {
			const response = await request(
				`/api/changes/file?${new URLSearchParams({ path, ...(context ? { context } : {}) })}`,
			);
			assert.equal(response.status, 200, await response.clone().text());
			return (await response.json()) as WorkspaceFileDiff;
		};
		const normalized = await diff("app/normalized.txt");
		assert.equal(normalized.kind, "text");
		if (normalized.kind !== "text") throw new Error("Expected normalized text patch");
		assert.deepEqual(normalized.statistics, { added: 2, removed: 1, binary: false });
		assert.deepEqual(normalized.codebases, { app: { root: "app", guidance: "owner" } });
		assert.equal(normalized.current.codebase, "app");
		assert.equal(normalized.baseline.kind, "commit");
		assert.match(normalized.patch, /--- a\/app\/normalized\.txt\n\+\+\+ b\/app\/normalized\.txt\n/);
		assert.ok(normalized.patch.includes("@@ -1 +1,2 @@\n-old\n+\uFEFFnew\n+last\n\\ No newline at end of file\n"));
		assert.equal(normalized.patch.includes("\r"), false);
		assert.equal(normalized.context, 3);
		assert.deepEqual(Object.keys(normalized.current).sort(), ["codebase", "kind", "mode", "path", "present"]);
		const bounded = await diff("app/context.txt");
		const full = await diff("app/context.txt", "all");
		assert.equal(bounded.kind, "text");
		assert.equal(full.kind, "text");
		if (bounded.kind !== "text" || full.kind !== "text") throw new Error("Expected context patches");
		assert.equal(bounded.context, 3);
		assert.equal(full.context, "all");
		assert.deepEqual(full.statistics, bounded.statistics);
		assert.deepEqual(full.baseline, bounded.baseline);
		assert.equal(bounded.patch.includes(" line 1\n"), false);
		assert.ok(full.patch.includes(" line 1\n"));
		assert.ok(full.patch.includes(" line 24\n"));
		assert.ok(full.patch.includes("-line 12\n+changed middle\n"));
		assert.equal(full.patch.includes("\r"), false);
		assert.ok(full.patch.length > bounded.patch.length);
		const destination = await diff("other/destination.txt");
		assert.equal(destination.kind, "text");
		if (destination.kind !== "text") throw new Error("Expected addition patch");
		assert.equal(destination.changeKind, "added");
		assert.equal(destination.base.present, false);
		assert.ok(destination.patch.includes("+rename original\n"));
		assert.equal((await diff("app/unchanged.txt")).kind, "not_changed");
		const deleted = await diff("app/deleted.txt");
		assert.equal(deleted.kind, "text");
		if (deleted.kind === "text") assert.equal(deleted.current.present, false);
		const empty = await diff("app/empty.txt");
		assert.equal(empty.kind, "metadata_only");
		if (empty.kind === "metadata_only") {
			assert.equal(empty.base.present, false);
			assert.equal(empty.current.present, true);
		}
		const moved = await diff("other/moved.md");
		assert.equal(moved.kind, "metadata_only");
		if (moved.kind === "metadata_only") {
			assert.equal(moved.changeKind, "renamed");
			assert.equal(moved.from, "app/pure.md");
			assert.equal(moved.base.path, "app/pure.md");
			assert.equal(moved.current.path, "other/moved.md");
		}
		const binary = await diff("nested/binary.dat");
		assert.equal(binary.kind, "unsupported");
		if (binary.kind === "unsupported") {
			assert.equal(binary.reason, "binary");
			assert.equal(binary.repo, "nested");
			assert.deepEqual(binary.codebases, { nested: { root: "nested", guidance: "nested/docs" } });
		}
		const literal = await diff(literalPath);
		assert.equal(literal.kind, "text");
		if (literal.kind === "text") {
			assert.equal(literal.path, literalPath);
			assert.ok(literal.patch.includes("+literal\n"));
		}
		for (const path of ["/api/changes/file?path=app%2Fnormalized.txt"]) {
			assert.equal((await request(path, { headers: { origin: "https://foreign.invalid" } })).status, 403);
			const method = await request(path, { method: "POST" });
			assert.equal(method.status, 405);
			assert.equal(method.headers.get("allow"), "GET, HEAD");
			const head = await request(path, { method: "HEAD" });
			assert.equal(head.status, 200);
			assert.equal(await head.text(), "");
		}
		for (const path of [
			"/api/changes/file",
			"/api/changes/file?path=app/a&path=app/b",
			"/api/changes/file?path=../outside",
			"/api/changes/file?path=app/a&context=4",
			"/api/changes/file?path=app/a&context=3&context=all",
			"/api/changes/file?path=app/a&unknown=x",
		]) {
			const response = await request(path);
			assert.equal(response.status, 400, path);
			assert.equal(((await response.json()) as { error: { code: string } }).error.code, "invalid_request");
		}
		assert.equal((await request("/api/files/content?path=app/normalized.txt&side=current")).status, 404);
		// A failing handler proves file operations never invoke analysis and stay available afterward.
		assert.equal((await request("/api/changes/analysis")).status, 500);
		assert.equal((await diff("app/normalized.txt")).kind, "text");
		renameSync(join(workspace, "nested/.git"), join(workspace, "nested/git-unavailable"));
		try {
			const failed = await request("/api/changes/file?path=app%2Fnormalized.txt");
			assert.equal(failed.status, 500);
			assert.deepEqual(await failed.json(), { error: { code: "internal_error", message: "Internal server error" } });
		} finally {
			renameSync(join(workspace, "nested/git-unavailable"), join(workspace, "nested/.git"));
		}
		assert.equal((await diff("app/normalized.txt")).kind, "text");
		write("app/normalized.txt", "old\r\n");
		assert.equal((await diff("app/normalized.txt")).kind, "not_changed");
		write("app/normalized.txt", "\uFEFFnew\r\nlast");
		assert.equal((await diff("app/normalized.txt")).kind, "text");
		assert.deepEqual(sourceState(workspace), beforeStartup);
		assert.deepEqual(await server.stop("SIGTERM"), { code: 0, signal: null }, server.stderr());
		assert.deepEqual(sourceState(workspace), beforeStartup);
	} finally {
		await server.stop("SIGKILL");
	}
	const released = await portReservation(reservation.port);
	await released.close();
}
