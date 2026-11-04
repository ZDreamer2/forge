---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge server verification

Run the pinned installation from the repository root, not `server/`; the
[README](../../../README.md#develop) owns commands and setup. The personal checker
runs `check:server`: server source and browser-safe contract verification, without
`dist/`, UI suites or packed installation acceptance. Assembled
HTTP tests inject temporary assets. The root gate adds packed installed API and
browser acceptance; [UI guidance](../../../ui/docs/forge/on-build.md) owns frontend
verification.

Server changes require app/CLI checks in `src/app/tests/` and the affected unit's
owner-local `tests/`. These use real temporary Git repositories, sockets and
spawned processes. Collector regressions couple staged reversals and stat-only
noise with index/object preservation to detect index-refresh writes. Requests and
shutdown preserve working files and Git state.

When live verification is required, follow the
[source-server instructions](../../../README.md#run-the-source-server), compare
API results with current Git state, and keep the authoritative checkout read-only.
Private observations and screenshots stay outside package contents.
