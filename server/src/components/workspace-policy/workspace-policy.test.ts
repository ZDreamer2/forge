import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadWorkspacePolicy } from "./index.ts";

test("loads an explicit trusted TypeScript module outside the application", async () => {
	const directory = await mkdtemp(join(tmpdir(), "forge-policy-"));
	try {
		const path = join(directory, "workspace.mts");
		await writeFile(
			path,
			"export default { repositories: [{path: '.'}, {path: 'absent'}], codebasesForChange: () => [] };",
		);
		const policy = await loadWorkspacePolicy(path);
		assert.deepEqual(policy.repositories, [{ path: "." }, { path: "absent" }]);
		assert.deepEqual(policy.codebasesForChange({ repo: ".", path: "a", kind: "modified" }), []);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("rejects malformed exports and propagates import failures", async () => {
	const directory = await mkdtemp(join(tmpdir(), "forge-policy-"));
	try {
		const path = join(directory, "invalid.mts");
		await writeFile(path, "export default { repositories: true };");
		await assert.rejects(loadWorkspacePolicy(path), /default-export a WorkspacePolicy/);
		await assert.rejects(loadWorkspacePolicy(join(directory, "missing.mts")), /Cannot find module/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("display names are literal text and explicit values must be nonempty strings", async () => {
	const directory = await mkdtemp(join(tmpdir(), "forge-policy-name-"));
	try {
		const values = ["BiCo", "</title><script>alert(1)</script>", " ", "", null, 42, {}, false, undefined];
		for (const [index, displayName] of values.entries()) {
			const path = join(directory, `name-${index}.mts`);
			await writeFile(
				path,
				`export default { displayName: ${JSON.stringify(displayName)}, repositories: [], codebasesForChange: () => [] };`,
			);
			if (typeof displayName === "string" && displayName.length > 0) {
				assert.equal((await loadWorkspacePolicy(path)).displayName, displayName);
			} else {
				await assert.rejects(loadWorkspacePolicy(path), /displayName must be a nonempty string/);
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
