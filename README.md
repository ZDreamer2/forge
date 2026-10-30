# @zdreamer/forge

Provisional Forge workspace application. The unreleased source supports a
foreground read-only workspace server and a minimal browser diagnostic, using the
shared `forge-workspace.yaml` registry. Registry release `0.1.1` remains the older
policy diagnostic; it has no server. Executable: `forge`. Licensed under [MIT](LICENSE).

The `0.x` configuration contract is provisional. Breaking changes require a minor
release with migration notes. No release or registry adoption is implied by source
acceptance. See [release operations](https://github.com/ZDreamer2/forge/blob/main/docs/releasing.md).

## Source layout

One package and installation own all dependencies. Its directories separate source
and runtime responsibilities; they are not workspace packages:

```text
server/src/    CLI, HTTP composition, domain components, public API contract and libs
ui/src/        reserved standalone React application root (no React/Vite scaffold yet)
docs/          application architecture and installation guidance
tools/         tooling/release and installed-consumer checks
dist/          normal TypeScript output, preserving server/src paths
```

The server retains its service conventions and local entries at
`server/docs/forge/`. UI implementation and its browser tooling remain future work;
the existing vanilla diagnostic is still server-owned. There are no member
manifests or duplicated dependency declarations. [Architecture](https://github.com/ZDreamer2/forge/blob/main/docs/architecture.md)
owns source dependencies and build boundaries. The application-owned
[HTTP API contract](https://github.com/ZDreamer2/forge/blob/main/server/docs/protocol.md)
specifies wire behavior independently of the currently implemented operations.

## Develop

Use Node 24.21.0 (`.nvmrc`) and Corepack pnpm 11.15.1:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --config.verify-deps-before-run=error run check
corepack pnpm --config.verify-deps-before-run=error run build
corepack pnpm --config.verify-deps-before-run=error run test:workspace
```

For server-only acceptance, run
`corepack pnpm --config.verify-deps-before-run=error run check:server` from this
root. It includes server/contract typechecks, server-scoped Biome checks,
architectural dependency rules and server tests.

The independent installation uses published `@zdreamer/forge-ts-service@0.1.1`
presets, their exact-pinned tool peers, the seven-day third-party release-age
floor, and explicit SWC script permission. `.cache/pnpm` is the portable default;
a hosting checkout can override the store during installation.

Tests live in lowercase `tests/` folders beside their owner: `server/src/app/tests/`
for assembly and CLI behavior, a component/lib/nested unit's own `tests/` for its
contract and internals, and `tools/tests/` for package tooling and tarball acceptance.
Test-only support and fixtures stay with these tests. Production builds exclude
entire `tests/` folders; test placement and private import boundaries are checked.
Tooling's temporary deliberately invalid source fixtures retain the paths required
to exercise real checkers and are removed after each check. The reserved frontend
keeps its separate naming convention.

`test:workspace` checks the browser-safe API contract and installed executable
through an isolated YAML-configured tarball consumer, without publishing or running
install scripts. It accepts no policy argument and verifies the removed authoring
export cannot be imported. Run
aggregate commands at the repository root: the gate delegates service-local checks
to `server/`, including its public API contract's browser-safety checks, and verifies
cross-runtime boundaries at the root.
Build is a clean followed by ordinary TypeScript compilation, without output
flattening or import rewriting. Root `bin` and `exports` select the emitted paths;
use the command/public export instead of depending on physical dist paths.

## Run the source server

After building, run from this repository:

```sh
node dist/server/src/main.js serve --workspace /absolute/path/to/checkout
```

The CLI form is `forge serve --workspace <path>` once a server-capable release
is installed. Relative workspace paths resolve against the invocation directory;
the selected directory is canonicalized as the authoritative checkout.

Startup loads exactly `<guidance-folder>/forge-workspace.yaml`. The default folder
is `docs/forge/workspace` inside the selected checkout. A nonempty process
`ZD_AI_FORGE_WORKSPACE_GUIDE` selects a different folder, relative to that checkout
or absolute; `.env` cannot set this override. Invalid explicit choices fail without
ancestor search or fallback. External guidance folders are allowed. The server
reads registered concrete/type markers as data and does not require
`on-codebase-selection.md` or execute YAML as code. Optional `analysis_handlers` references load trusted modules at startup.

Set `ZD_AI_FORGE_PORT` in the process environment or selected checkout's `.env`.
A nonempty process value takes precedence, including invalid values; an empty
process value falls back to `.env`. Ports use one to five ASCII decimal digits
and range from 1024 through 65535. There is no default, allocation or occupied-port
fallback. The narrow `.env` syntax supports whole-line comments, optional
`export`, whitespace and surrounding quotes; last assignment wins and malformed
lines are ignored. It performs no interpolation, multiline or escape expansion;
only the port setting is imported. A missing `.env` is allowed, while unreadable
or invalid-encoding files fail startup.

After listener readiness, the foreground process prints its package version,
JSON-quoted executable and authoritative workspace paths, then
`http://127.0.0.1:<port>` on its own line. It prints no environment values.
Open that address to see workspace/repository identity and current changed files,
including Git-reported rename sources and concrete
codebase memberships. Workspace names, paths and guidance are displayed literally
as text. The browser title uses `🛠️ <workspace name>` from server identity;
it starts as `Forge` and returns to `Forge` when the identity request fails.
The page shows loading, empty and error states; Refresh retries failed requests and clears the
previous change list while loading. Successful workspace identity is retained
when a request fails. Refresh reads current changes but does not reload startup
configuration or repository participation. There is no polling.

`GET /api/workspace` returns the workspace root, resolved display name and declared
available/missing repositories in declaration order. Invalid existing repositories, Git/access
failures and configuration errors refuse startup. Requests require that
exact Host and, when present, Origin; CLI requests may omit Origin. Restart to
reload configuration and repository identity. Stop with SIGINT or
SIGTERM; shutdown closes the listener and releases the port.

`GET /api/changes` returns
`{ codebases: { root: { root: "path", guidance: "path", type?: "id" } }, changes: [...] }`. Changes carry repo,
workspace-relative path, added/modified/deleted/renamed kind, optional rename
`from` and unique codebase ID arrays. Definitions occur once per response;
identities are registered workspace-relative concrete roots and include both
present-side rename owners. No binary/line counts are exposed.

Comparison uses one bulk HEAD/working `diff --raw --numstat -z` and non-ignored untracked listing,
with targeted normalized reconciliation for recreated deletion/rename
sources. Index refresh is disabled; numstat presence removes raw stat noise while
mode/type changes, zero-count changes and binaries remain. The light response omits counts; the analysis response exposes raw and attention-filtered totals.
Identical staged reversals disappear. Git owns attributes, filters and
index flags; hidden flag edits can remain hidden, and ignored recreations absent
from the untracked list remain deletions. Unstaged moves stay deletion/addition.
Unborn HEAD is supported; conflicts fail even with no diff. This is practical Git
comparison, not exhaustive physical equivalence or a replacement for dirt detection.

The observed command baseline is Git 2.34.1. Complete local repositories are
supported; partial/promisor repositories fail before object-demanding comparison
to prevent silent lazy fetch. Normal trusted clean/process filters are allowed;
external diff/textconv, optional writes, fsmonitor and hooks are disabled. Ambient
Git repository/index/worktree overrides do not select another checkout. Server
commands do not stage/commit/write source index, ref or object contents. Native Git
can freshen shared-index mtimes during reads. Exceptional
pair statistics use owned temporary indexes outside the checkout. Trusted filters and analysis handlers
can execute code with side effects; this is not an effects sandbox.

Missing-at-startup repositories remain excluded; loss of an available repository,
Git failures fail the whole request. Paths
stay inside the workspace even when its Git root extends above it. Declared
nested repositories are distinct; undeclared clones and Git internals are excluded.
Results are live observations, without atomic cross-repository snapshots.
Overlapping requests share one active collection, with no result cache. A
30-second collection deadline bounds waiting; shutdown aborts and reaps active
Git children before completion. The browser allows 35 seconds per request, then restores retry.

For a direct check while the server runs, replace the example address with the
address printed by the server:

```sh
FORGE_ADDRESS=http://127.0.0.1:12345
curl "$FORGE_ADDRESS/api/workspace"
curl "$FORGE_ADDRESS/api/changes"
curl "$FORGE_ADDRESS/api/changes/analysis"
```

`GET /api/changes/file?path=<change-path>` returns a renderer-neutral patch with
three context lines or an explicit metadata-only/unsupported outcome. Request
`&context=all` for complete context around changed payloads, enabling omitted-context
expansion without a separate file-content API. Both modes are bounded; all-context
can exceed the patch cap while the short diff remains usable.
[Patch API semantics and limits](server/docs/protocol.md#read-file-diff) describe
Git normalization, side identities, symlink targets, metadata-only outcomes,
per-request cancellation and live baseline identities. These requests run no handlers.

The server and browser page are read-only. React diff rendering, file browsing,
staging/commits and agent interaction remain future work. Registry `0.1.1` remains the diagnostic-only
release; source and installed-tarball verification do not constitute publication
or registry adoption.

## Workspace configuration and migration

The source reads the same concrete registry as Python Forge, with required server
repository declarations and optional display name:

```yaml
display_name: Example workspace
repositories:
  - .
  - tools/optional-checkout
codebases:
  - ../../../app/docs/forge/forge-codebase.yaml
codebase_types: []
```

Marker references are relative to the containing YAML file; repository IDs are
normalized workspace-relative POSIX paths, with `.` for the main repository.
Repository declarations are ordered and explicit; codebase registration does not
opt a repository into collection. Missing marker/root directories are skipped;
present malformed declarations, duplicate references/roots/type IDs and unknown
adopted types fail startup. Closest registered roots determine membership lexically,
including deleted and renamed paths. Registry parity with Python does not imply
repository discovery or staging-scope parity: Python still scans repositories.

`display_name` is an optional nonempty string, preserved literally. If omitted,
the server uses the canonical workspace basename (or root itself). Restart reloads
configuration, registry markers and repository participation.

This is a breaking migration from the earlier executable policy:

- Move `displayName` to YAML `display_name` and the ordered repository paths to
  YAML `repositories`. Register concrete/type marker files in the shared registry.
- Remove `workspace.ts`, policy-specific TypeScript checks and imports from
  `@zdreamer/forge/workspace`; that export is removed.
- Remove uses of `forge inspect-workspace` and the optional `test:workspace`
  policy argument. The supported source CLI is `forge serve --workspace <path>`.
- Keep an independent exact-pinned executable installation when useful. Existing
  registry `0.1.1` installations remain diagnostic-only until an approved release
  and explicit repin. No compatibility loader is provided.

## Analysis handlers

`GET /api/changes/analysis` returns a path-indexed tree with explicit child lists,
raw and attention-filtered added/removed line totals, emphasis, attributed signals
and inclusive warning/notice counts. Hidden nodes remain present. Built-ins
reduce attention on workspace-root `plans/` and directories named `tests` or
`Tests`, and warn on current added/modified Markdown strictly larger than 20,480
bytes, including content-edited renames. Pure moves, deletions and current root
`plans/` paths do not warn. Sizes are looked up lazily without reading file bytes.

Register trusted modules with optional ordered `analysis_handlers` lists on
`forge-workspace.yaml` or a concrete `forge-codebase.yaml`:

```yaml
analysis_handlers:
  - ./analysis.ts
```

```ts
import type { AnalysisHandler } from '@zdreamer/forge/analysis';

const analyze: AnalysisHandler = (root) => {
  for (const node of root.walk()) {
    if (node.path === 'tests/critical') node.restoreNormalEmphasis('Review critical tests');
  }
};
export default analyze;
```

Paths resolve relative to their declaring YAML. Native ESM `.ts`/`.mts` (erasable
TypeScript syntax) and `.js`/`.mjs` modules export one default function; relative
imports use explicit extensions. The type-only public `./analysis` entry supplies
authoring vocabulary, without operational loader/runner APIs. No runtime helper
import is needed. Restart the process to reload modules.

Handlers run after built-ins, workspace first and then concrete codebases in registry
order. Every handler sees and may annotate the whole workspace tree. A module
load or invocation error fails analysis with a safe configured handler identity,
while `/api/changes` remains available. Each request owns its annotations and
30-second operation budget. Trusted handlers are not sandboxed, and synchronous
JavaScript cannot be forcibly interrupted. See the [analysis authoring guide](server/src/components/tree-analysis/docs/UnitGuide.md)
for context, source access, concurrency, lifetime and attribution semantics.
