---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# @zdreamer/forge

Read-only workspace server and React changes viewer using the shared
`forge-workspace.yaml` registry. Review changes with Type/Importance filters,
signal inspection and syntax-highlighted unified/split diffs.
Executable: `forge`. Licensed under [MIT](LICENSE).

Read the [codebase overview](docs/overview.md) for repository orientation and routes
to task-specific documentation.

Version `0.2.0` delivers the read-only viewer and unified-guide configuration
migration described below. Upgrade older installations using the migration notes;
package publication and workspace adoption are separate operations.

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

See [application architecture](https://github.com/ZDreamer2/forge/blob/main/docs/architecture.md) for boundaries,
[UI architecture](ui/docs/architecture.md) for frontend ownership and state,
and the [HTTP API contract](https://github.com/ZDreamer2/forge/blob/main/server/docs/protocol/overview.md) for wire behavior.
Concrete server and UI build guides live under their respective `docs/forge/`
directories.

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

Root `check` composes installation validation, server and UI source checks, then
fresh packed installed API and Chromium acceptance. It builds and packs once; CI
uses this same gate and retains the checked artifact.

Focused scripts use `corepack pnpm --config.verify-deps-before-run=error run <name>`:

- `check:installation`: tooling types/lint/tests, shared boundaries and clean packed
  installed integration, without component source suites.
- `check:installation:source`: installation validation without building or packing.
- `check:server`: server/contract checks and tests, without a UI build or `dist/`.
- `test:ui`: frontend behavior suites.
- `check:ui`: frontend structure/collection/types/configuration/lint/behavior and frontend-only build.
- `build:ui`: frontend-only Vite emission to `dist/ui/`, including route-tree generation.
- `build`: clean application assembly: server compilation and `build:ui`.
- `test:workspace`: self-contained build, pack and installed API/browser acceptance.

Keep exact pins, the seven-day third-party release-age floor and explicit lifecycle
permissions. `.cache/pnpm` is the portable store default; any host override needs
to match between install and check.

## Run the source server

After building, run from this repository:

```sh
node dist/server/src/main.js serve --workspace /absolute/path/to/checkout
```

The installed CLI form is `forge serve --workspace <path> [--server-hub]`.
Add `--server-hub` once to explicitly host the server hub in this process. It keeps
serving its own workspace and UI. The flag can precede or follow `--workspace <path>`;
user settings cannot turn this role on or off. Relative workspace
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
and loopback address. Open that address for the viewer. Refresh observes changes;
restart reloads authored workspace configuration, extensions and repository participation. Stop with
SIGINT or SIGTERM.

GET/HEAD `/` and exact `/assets/` resources are served from the installed package,
independently of the invocation directory. Unknown paths and missing assets return
404 without an HTML fallback. All requests require the printed Host and, when
present, Origin; use `127.0.0.1`, not `localhost`.

Changes compare HEAD with working content, including non-ignored untracked files.
Declared repositories participate; missing-at-startup repositories stay excluded
until restart. Results are live observations. See the
[shared API contract](server/docs/protocol/overview.md#shared-contract) for access and the
[change contract](server/docs/protocol/changes.md) for comparison, ownership and lifecycle
semantics. Inspection preserves source and Git
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

The viewer provides a workspace-relative changes tree, inclusive folder summaries,
canonical selection and file diffs. Direct links use `/?path=src/example.ts`, with
`/?path=.` for the workspace root; filtered or empty subjects remain directly
selectable. File patches and complete context are live observations.

See [UI architecture](ui/docs/architecture.md#selected-file-observations) for
selection, refresh and recovery behavior, the
[API file contract](server/docs/protocol/changes.md#read-file-diff) for patches and limits,
and the [viewer design specification](ui/prototype/UiSpec.md) for interaction and
presentation design. The prototype demonstrates intended behavior with fictional
data; it does not establish production implementation or performance.

## Local configuration and reload

Local settings live in `$XDG_CONFIG_HOME/zd-forge` when `XDG_CONFIG_HOME` is a
nonempty absolute path, otherwise in `$HOME/.config/zd-forge`. Relative XDG values
are ignored. Reads do not create files. The supported data-only YAML files are:

`config.yaml`:

```yaml
serverHubUrl: http://127.0.0.1:4311/
```

`server-hub.yaml`:

```yaml
servers:
  - id: bico
    name: BiCo workspace
    url: http://127.0.0.1:4311/
```

IDs are unique ASCII slugs; names are literal nonblank display strings. URLs are
absolute HTTP(S) base URLs with optional base paths, without credentials, query or
fragment. Unknown fields, explicit null settings and duplicate YAML keys are
rejected. Missing/empty documents mean no hub URL or an empty registration list.
A list has at most 64 registrations; ID/name/URL limits are 128/256/2048 UTF-8
bytes (URL checked before and after normalization). Editing files does not activate
hosting. On an active host, accepted registration reloads change background probes.
`serverHubUrl` consumption and UI switching are deferred; selecting a URL does not
change the hosted list or relay another hub.

After editing a file, use the server's printed address:

```sh
curl -H 'Content-Type: application/json' -d '{}' "$FORGE_ADDRESS/api/configuration/reload"
```

Each concern independently accepts or rejects the change. Rejection retains an
earlier accepted value; invalid initial configuration is unavailable and logged,
while workspace review remains usable. Repair the file and reload to recover.
The [reload contract](server/docs/protocol/overview.md#reload-local-configuration) defines
result metadata and diagnostics. Reload does not apply authored registry, extension,
guidance-path or port changes; restart for those. Hosting is a startup role;
changing installed services to adopt it is a separate administration step.

On a host, inspect the accepted list and centrally observed availability:

```sh
curl "$FORGE_ADDRESS/api/server-hub/servers"
```

The response is immediate; probes run in the background from the hub, so status
does not prove that a browser can reach a target. Invalid initial registrations
return 503 until repaired and reloaded; rejected later edits retain the accepted
list. The [hub contract](server/docs/protocol/overview.md#inspect-hosted-server-hub) defines
freshness, limits and failures.

Current-issue storage stays in the selected guidance folder's `.local/state.json`,
including with a relative or external guidance override. Compatible Python/server
writers preserve unrelated fields under the shared `.local/state.json.lock`
directory lock. A crashed writer can leave this lock: confirm no writer remains
before manually removing that exact lock directory, then retry. Reload only reads
state. The [storage guide](server/src/components/configuration/docs/UnitGuide.md)
owns the format and writer protocol.

## Workspace configuration and migration

The server reads the unified guide registry shared with Python Forge, with required
server repository declarations and optional display name:

```yaml
display_name: Example workspace
repositories:
  - .
  - tools/optional-checkout
parents:
  - shared-conventions
codebases:
  - ../../../shared/conventions/forge-codebase.yaml
  - ../../../app/docs/forge/forge-codebase.yaml
```

Each registered marker is named `forge-codebase.yaml`. In this example, the shared
marker declares `id: shared-conventions` and omits `root`. The app marker declares:

```yaml
id: example-app
root: ../..
parents:
  - shared-conventions
```

`id` is a required nonempty stable guide identifier, unique among available guides.
`root` is optional and relative to the marker directory. A rootless guide supplies
reusable conventions; only available rooted guides own source paths. Ordered
`parents` lists reference distinct registered guide IDs. A rooted guide can also
be reused as a parent without changing its ownership.

Marker references are relative to the containing YAML file; repository paths must
be normalized workspace-relative POSIX paths, with `.` for the main repository.
Repository declarations are ordered and explicit; registering a codebase does not
opt a repository into collection. Closest registered roots determine membership
lexically, including deleted and renamed paths. Python retains its separate
repository scan; registry parity does not imply collection or staging-scope parity.

Missing markers or source roots make registrations unavailable and are optional
until required by ancestry. Present malformed declarations fail even when their
root is missing. Duplicate canonical references, available IDs or roots fail.
Startup validates the workspace chain and independently composes every available
rooted participant with it, including participants without changes. Required
unavailable parents, cycles and contradictory ordering fail before handlers load
or the listener opens. Unrelated rootless ancestry stays unresolved.

`display_name` is an optional nonempty string, preserved literally. If omitted,
the server uses the canonical workspace basename (or root itself). Restart reloads
registration, composition and repository participation; Refresh observes changes
within that startup context.

This is a breaking configuration and public vocabulary migration:

- Replace old type markers with `forge-codebase.yaml`, add stable `id`, register all
  guides in `codebases`, and replace `type` adoption with ordered `parents`.
  Remove `codebase_types`, including empty lists. Legacy declarations fail with
  migration diagnostics rather than compatibility aliases.
- Public analysis-owner facts require `{id, root, guide}`. Changes, analysis and
  file definitions require `{id, root, guidance}`. Definition-map keys and owner
  references remain workspace-relative roots (`.` allowed); stable IDs are values,
  not replacement keys. Ancestry is not exposed as an ownership graph.

Earlier executable-policy installations also need YAML `display_name` and
`repositories`, removal of `workspace.ts` and `@zdreamer/forge/workspace` imports,
and the supported `forge serve --workspace <path>` CLI instead of
`forge inspect-workspace`. Publication and installation repins are separate from
source migration.

## Guide extensions

The [analyzed tree](server/docs/protocol/analysis.md) supplies
classification, raw and attention totals, emphasis and attributed signals. Policies
come from adopted guides. Registering Forge-base and adopting it through workspace
`parents` enables its path classification, planning/test deemphasis and large
changed Markdown warnings. Registration alone does not apply a rootless guide.
Without adopted policies, classification defaults to `code`, emphasis is normal
and signals are empty.

Each workspace or codebase guide can supply the fixed entry
`forge-extension/forge-extension.ts`, with private `internal/` modules and owner-local
`tests/` when needed:

```ts
import type { ForgeExtension } from '@zdreamer/forge/extension';

export default {
  api: 1,
  annotateNode(ctx) {
    if (ctx.node.path === 'tests/critical')
      ctx.node.restoreNormalEmphasis('Review critical tests');
  },
} satisfies ForgeExtension;
```

Use named type-only imports from `@zdreamer/forge/extension`, native erasable
TypeScript ESM and explicit relative import extensions.

Remove YAML `analysis_handlers`, including empty lists, and replace legacy
`@zdreamer/forge/analysis` imports and whole-tree functions with fixed extension
units. Unknown hooks and unsupported `api` revisions fail loading.

Modules load at startup; restart to reload them. Extensions are trusted,
unsandboxed code: await all work and cooperate with cancellation. An applicable
load or hook failure rejects analysis while light APIs remain usable.
See the [analysis guide](https://github.com/ZDreamer2/forge/blob/main/server/src/components/tree-analysis/docs/UnitGuide.md)
for hook scheduling, attribution, source capabilities and execution limits.
