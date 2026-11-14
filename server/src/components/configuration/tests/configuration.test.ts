import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type ConfigurationRead, createConfiguration } from "../index.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
	const root = await mkdtemp(join(tmpdir(), "forge-configuration-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const locations = {
		workspaceRoot: join(root, "workspace"),
		userConfigDirectory: join(root, "user"),
		guidanceDirectory: join(root, "external-guide"),
	};
	await mkdir(locations.workspaceRoot);
	await mkdir(locations.userConfigDirectory);
	await mkdir(locations.guidanceDirectory);
	return {
		root,
		locations,
		config: join(locations.userConfigDirectory, "config.yaml"),
		hub: join(locations.userConfigDirectory, "server-hub.yaml"),
		state: join(locations.guidanceDirectory, ".local", "state.json"),
	};
}

function value<T>(read: ConfigurationRead<T>): T {
	if (!read.available) throw new Error(read.diagnostic);
	return read.value;
}

test("missing sources accept explicit defaults and create no files", async (t) => {
	const f = await fixture(t);
	const owner = await createConfiguration(f.locations);
	assert.equal(value(owner.readServerHubUrl()), undefined);
	assert.deepEqual(value(owner.readServers()), []);
	assert.equal(value(owner.readCurrentIssue()), undefined);
	assert.deepEqual(owner.readCurrentIssue().source, { scope: "workspace", path: f.state, provenance: "default" });
	assert.equal(owner.readServerHubUrl().source.scope, "user");
	assert.deepEqual(await readdir(f.locations.userConfigDirectory), []);
	assert.deepEqual(await readdir(f.locations.guidanceDirectory), []);
	assert.equal((await owner.reload()).ok, true);
});

test("file changes require explicit reload; rejection retains the immutable accepted snapshot", async (t) => {
	const f = await fixture(t);
	await writeFile(f.config, "serverHubUrl: https://example.com/base\n");
	await writeFile(
		f.hub,
		'servers:\n  - {id: One, name: " <Display> ", url: https://example.com/base/}\n  - {id: two, name: Another, url: https://example.com/base}\n',
	);
	const owner = await createConfiguration(f.locations);
	const accepted = owner.readServerHubUrl();
	assert.equal(value(accepted), "https://example.com/base/");
	const registrations = value(owner.readServers());
	assert.equal(registrations[0]?.name, " <Display> ");
	assert.equal(registrations[0]?.url, registrations[1]?.url);
	assert.ok(Object.isFrozen(registrations) && Object.isFrozen(registrations[0]) && Object.isFrozen(accepted.source));
	await writeFile(f.config, "serverHubUrl: http://127.0.0.1:4311/next\n");
	assert.equal(owner.readServerHubUrl(), accepted);
	assert.equal((await owner.reload()).ok, true);
	assert.equal(value(owner.readServerHubUrl()), "http://127.0.0.1:4311/next/");
	await writeFile(f.config, "serverHubUrl: null\n");
	await writeFile(f.hub, "servers: []\n");
	const mixed = await owner.reload();
	assert.equal(mixed.ok, false);
	assert.equal(mixed.concerns.serverHubUrl.status, "rejected");
	assert.equal(mixed.concerns.serverHubUrl.retainedPriorValue, true);
	assert.equal(mixed.concerns.servers.status, "accepted");
	assert.equal(value(owner.readServerHubUrl()), "http://127.0.0.1:4311/next/");
	assert.deepEqual(value(owner.readServers()), []);
	assert.ok(Object.isFrozen(mixed) && Object.isFrozen(mixed.concerns.serverHubUrl));
	assert.ok(!JSON.stringify(mixed).includes("127.0.0.1"));
	await rm(f.config);
	await rm(f.hub);
	assert.equal((await owner.reload()).ok, true);
	assert.equal(value(owner.readServerHubUrl()), undefined);
	assert.equal(owner.readServerHubUrl().source.provenance, "default");
});

for (const text of ["", "# comment\n", "---\n", "{}", "serverHubUrl: https://EXAMPLE.com:443/base///"]) {
	test(`accepts optional/empty user configuration ${JSON.stringify(text)}`, async (t) => {
		const f = await fixture(t);
		await writeFile(f.config, text);
		const owner = await createConfiguration(f.locations);
		assert.equal(owner.readServerHubUrl().available, true);
		assert.equal(owner.readServerHubUrl().source.provenance, "file");
	});
}

const invalidConfig = [
	["null", "$"],
	["[]", "$"],
	["true", "$"],
	["serverHubUrl: null", "serverHubUrl"],
	["serverHubUrl: 3", "serverHubUrl"],
	["serverHubUrl: /relative", "serverHubUrl"],
	["serverHubUrl: ftp://example.com", "serverHubUrl"],
	["serverHubUrl: https://user:pass@example.com/", "serverHubUrl"],
	["serverHubUrl: https://@example.com/", "serverHubUrl"],
	["serverHubUrl: https://example.com/?", "serverHubUrl"],
	["serverHubUrl: https://example.com/#", "serverHubUrl"],
	['serverHubUrl: "https://example.com/a b"', "serverHubUrl"],
	["servers: []", "servers"],
	["port: 999", "port"],
	["serverHubUrl: https://a\nserverHubUrl: https://b", "$"],
	["serverHubUrl: [", "$"],
	["serverHubUrl: !unsupported data", "$"],
];
for (const [text, field] of invalidConfig) {
	test(`rejects unsupported user YAML ${JSON.stringify(text)}`, async (t) => {
		const f = await fixture(t);
		await writeFile(f.config, text ?? "");
		const owner = await createConfiguration(f.locations);
		const read = owner.readServerHubUrl();
		assert.equal(read.available, false);
		if (read.available) throw new Error("expected unavailable");
		assert.ok(read.diagnostic.includes(field ?? "$"));
		assert.ok(read.diagnostic.length <= 320);
		const result = (await owner.reload()).concerns.serverHubUrl;
		assert.equal(result.retainedPriorValue, false);
		await writeFile(f.config, "serverHubUrl: https://recovered.example\n");
		assert.equal((await owner.reload()).ok, true);
		assert.equal(value(owner.readServerHubUrl()), "https://recovered.example/");
	});
}

for (const text of [
	"servers: null",
	"servers: {}",
	"servers: [null]",
	"servers: [{id: '', name: A, url: https://a}]",
	"servers: [{id: é, name: A, url: https://a}]",
	"servers: [{id: one, name: ' ', url: https://a}]",
	"servers: [{id: one, name: A, url: /relative}]",
	"servers: [{id: one, name: A, url: https://a, port: 4}]",
	"servers: [{id: one, name: A, url: https://a}, {id: one, name: B, url: https://b}]",
	"serverHubUrl: https://a",
]) {
	test(`rejects invalid registration document ${JSON.stringify(text)}`, async (t) => {
		const f = await fixture(t);
		await writeFile(f.hub, text);
		const owner = await createConfiguration(f.locations);
		assert.equal(owner.readServers().available, false);
		assert.equal(owner.readServerHubUrl().available, true);
		assert.equal((await owner.reload()).concerns.servers.retainedPriorValue, false);
	});
}

test("invalid UTF-8, unreadable sources and malformed state stay distinct from absence", async (t) => {
	const f = await fixture(t);
	await writeFile(f.config, Buffer.from([0xff]));
	await mkdir(f.hub);
	await mkdir(join(f.locations.guidanceDirectory, ".local"));
	await writeFile(f.state, "{");
	const owner = await createConfiguration(f.locations);
	assert.equal(owner.readServerHubUrl().available, false);
	assert.equal(owner.readServers().available, false);
	assert.equal(owner.readCurrentIssue().available, false);
	await writeFile(f.config, "{}");
	assert.equal((await owner.reload()).concerns.serverHubUrl.status, "accepted");
	assert.equal(owner.readCurrentIssue().available, false);
	assert.equal(await readFile(f.state, "utf8"), "{");
});

test("registration count and UTF-8 bounds accept edges and retain accepted data on rejection", async (t) => {
	const f = await fixture(t);
	const base = { id: "a".repeat(128), name: "é".repeat(128), url: `https://example.com/${"a".repeat(2027)}/` };
	assert.equal(Buffer.byteLength(base.url), 2048);
	await writeFile(f.hub, JSON.stringify({ servers: [base] }));
	const owner = await createConfiguration(f.locations);
	assert.deepEqual(value(owner.readServers()), [base]);
	const accepted = owner.readServers();
	for (const entry of [
		{ ...base, id: `${base.id}a` },
		{ ...base, name: `${base.name}é` },
		{ ...base, url: `${base.url}a` },
		{ ...base, url: `${base.url.slice(0, -1)}é` },
		// Raw input fits; normalization adds a trailing slash or percent-encodes Unicode.
		{ ...base, url: `${base.url.slice(0, -1)}a` },
		{ ...base, url: `https://example.com/${"é".repeat(400)}` },
	]) {
		await writeFile(f.hub, JSON.stringify({ servers: [entry] }));
		const outcome = (await owner.reload()).concerns.servers;
		assert.equal(outcome.status, "rejected");
		assert.equal(outcome.retainedPriorValue, true);
		assert.equal(owner.readServers(), accepted);
	}
	const entries = Array.from({ length: 64 }, (_, index) => ({ ...base, id: `s${index}` }));
	await writeFile(f.hub, JSON.stringify({ servers: entries }));
	assert.equal((await owner.reload()).ok, true);
	assert.deepEqual(value(owner.readServers()), entries);
	await writeFile(f.hub, JSON.stringify({ servers: [...entries, { ...base, id: "extra" }] }));
	assert.equal((await owner.reload()).concerns.servers.status, "rejected");
	assert.deepEqual(value(owner.readServers()), entries);
	const fresh = await createConfiguration(f.locations);
	assert.equal(fresh.readServers().available, false);
});
