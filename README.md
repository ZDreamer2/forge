---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# @zdreamer/forge

Read-only workspace server and React overview using the shared
`forge-workspace.yaml` registry. The overview shows workspace identity, changed-entry
count and separately labelled all-change and attention line totals.
Executable: `forge`. Licensed under [MIT](LICENSE).

Registry `0.1.2` is the published server baseline; the React overview is unreleased.

The `0.x` configuration contract is provisional. Breaking changes require a minor
release with migration notes. Source acceptance, publication and hosting adoption
are separate. See [release operations](https://github.com/ZDreamer2/forge/blob/main/docs/releasing.md).

## Source layout

One package and installation own all dependencies. Its directories separate source
and runtime responsibilities; they are not workspace packages:

```text
server/src/    CLI, HTTP composition, domain components, public API contract and libs
ui/src/        standalone React application, providers and browser data access
docs/          application architecture and installation guidance
tools/         tooling/release and installed-consumer checks
dist/          server TypeScript output and Vite-built ui/ assets
```

[Architecture](https://github.com/ZDreamer2/forge/blob/main/docs/architecture.md)
owns application boundaries; the
[HTTP API contract](https://github.com/ZDreamer2/forge/blob/main/server/docs/protocol.md)
owns wire behavior. Concrete server and UI guides live under their respective
`docs/forge/` directories.

## Develop

Use Node 24.21.0 (`.nvmrc`) and Corepack pnpm 11.15.1 from this independent
installation root. Select that Node before running Corepack. Setup is explicit:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --config.verify-deps-before-run=error exec playwright install chromium
```

Install Chromium's OS dependencies separately where required (`playwright install-deps
chromium`). Checks install neither packages nor browsers.

```sh
corepack pnpm --config.verify-deps-before-run=error run check
```

Root `check` covers server and UI source checks, frontend behavior/build, then
packed installed API and Chromium acceptance. It builds and packs once; CI uses
this same gate and retains the checked artifact.

Focused scripts use `corepack pnpm --config.verify-deps-before-run=error run <name>`:

- `check:server`: server/contract checks and tests, without a UI build or `dist/`.
- `test:ui`: frontend behavior suites.
- `check:ui`: frontend structure/collection/type/lint/behavior and production build.
- `build`: clean server compilation and Vite emission to `dist/ui/`.
- `test:workspace`: self-contained build, pack and installed API/browser acceptance.

Keep exact pins, the seven-day third-party release-age floor and explicit lifecycle
permissions. `.cache/pnpm` is the portable store default; any host override needs
to match between install and check.

## Run the source server

After building, run from this repository:

```sh
node dist/server/src/main.js serve --workspace /absolute/path/to/checkout
```

The installed CLI form is `forge serve --workspace <path>`. Relative workspace
paths resolve against the invocation directory; the selected directory is
canonicalized as the authoritative checkout.

Startup reads `docs/forge/workspace/forge-workspace.yaml` inside the selected
checkout. A nonempty process `ZD_AI_FORGE_WORKSPACE_GUIDE` selects another guidance
folder, relative to the checkout or absolute; `.env` cannot override it. Invalid
explicit choices fail without fallback.

Set `ZD_AI_FORGE_PORT` in the process environment or the checkout's `.env`.
A nonempty process value takes precedence; ports are decimal integers from 1024
through 65535, with no default or occupied-port fallback. Only the port is read
from `.env`, without interpolation; unreadable or invalid-encoding files fail startup.

Once ready, the foreground process prints its version, executable/workspace paths
and loopback address. Open that address for the overview. Refresh rereads identity
and analysis independently, retaining usable data and marking failed refreshes
stale. Restart reloads configuration and repository participation. Stop with
SIGINT or SIGTERM.

GET/HEAD `/` and exact `/assets/` resources are served from the installed package,
independently of the invocation directory. Unknown paths and missing assets return
404 without an HTML fallback. All requests require the printed Host and, when
present, Origin; use `127.0.0.1`, not `localhost`.

Changes compare HEAD with working content, including non-ignored untracked files.
Declared repositories participate; missing-at-startup repositories stay excluded
until restart. Results are live observations. See the
[shared API contract](server/docs/protocol.md#shared-contract) for comparison,
ownership, access and lifecycle semantics. Inspection preserves source and Git
index/ref/object contents; trusted Git filters and analysis handlers are executable
code outside that effects guarantee.

For a direct check while the server runs, replace the example address with the
address printed by the server:

```sh
FORGE_ADDRESS=http://127.0.0.1:12345
curl "$FORGE_ADDRESS/api/workspace"
curl "$FORGE_ADDRESS/api/changes"
curl "$FORGE_ADDRESS/api/changes/analysis"
```

The API also exposes [bounded file patches](server/docs/protocol.md#read-file-diff).
The current overview is read-only; changes-tree navigation and diff rendering
remain future work.

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
  registry installations of the earlier diagnostic remain unchanged until an approved
  release and explicit repin. No compatibility loader is provided.

## Analysis handlers

The [analyzed tree](server/docs/protocol.md#analyze-workspace-changes) supplies raw
and attention totals, emphasis and attributed signals. Built-in and configured
handlers annotate the same canonical tree.

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

Handlers run after built-ins, workspace first and then concrete codebases in
registry order. They can annotate the whole tree. A handler failure fails analysis
while `/api/changes` remains available. See the
[analysis authoring guide](server/src/components/tree-analysis/docs/UnitGuide.md)
for source capabilities, attribution and execution limits.
