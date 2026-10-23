# Forge application verification

The [README](../../../README.md#develop) centralizes the pinned runtime and aggregate
check/build/tarball-consumer commands. Run them from this independent repository
root, not `server/`. Standalone `check:server` includes server/contract typechecks,
server-scoped Biome lint/format checks, architectural rules and server tests.
Service graph checks/tests run from `server/`, preserving local path semantics;
the root graph also enforces UI access
through the contract entry only.
Consumer tests exercise the actual tarball; source imports or a symlink are
not packaging evidence. Pass an absolute consuming `workspace.ts` path as the
optional `test:workspace` argument to verify real policy types and the installed
diagnostic without embedding private rules into this public repository.

Server changes require the colocated app/CLI checks as well as unit checks. They
exercise real temporary Git repositories, sockets and spawned CLI processes:
configuration precedence, identity, fresh HEAD/working changes and routing,
Host/Origin enforcement, repository-loss failures, occupied-port failure and bounded
SIGINT/SIGTERM shutdown. Collector fixtures cover staging reversals, boundary
filtering, mode/type/binary/empty changes and Git normalization, and source Git state preservation.
Exercise staged reversals and stat-only noise in the same fixture as index/objects
preservation: raw-only diff previously passed those checks in separate fixtures
while missing an index-refresh write. The collector uses combined raw/numstat
output with index refresh disabled; zero counts and binary markers remain changes.
Requests and shutdown leave working files and Git indexes unchanged. The aggregate
gate includes these checks and diagnostic-page routing, HEAD/method behavior and
request protection. Route tests and HTML assertions do not execute browser
JavaScript.

For a direct source check, build and use the [source server
instructions](../../../README.md#run-the-source-server), then request
`/api/workspace` and `/api/changes` with the configured loopback authority. Each
non-overlapping changes request collects current HEAD/working changes using startup policy/repository participation;
missing-at-startup checkouts remain skipped and available-checkout failures are
explicit errors. Open `/` for the service-owned diagnostic page. Refresh retries
both APIs and reads current changes; restart reloads policy/repository
participation. The UI remains read-only, with text paths and no diff/file browser.

For browser changes, smoke-test the installed tarball in a real browser against
controlled Git fixtures: identity and missing repositories, Refresh after edits,
empty and failed-request states, successful retry and button recovery, Git-reported rename sources, and HTML-like paths/memberships rendered literally. Check the
console/network and verify working files, indexes and refs remain unchanged apart
from deliberate fixture edits. Also compare the page against API/Git state on the
authoritative checkout without automated mutations. Keep private observations and
screenshots outside public package contents; record any observation limits.

Registry `0.1.1` remains the diagnostic-only release. Retain tarball/public-type
verification and release-workflow checks when extending the source; publication
and registry adoption require their separate release gates.
