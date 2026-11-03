---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# @zdreamer/forge

Read-only workspace server and React changes navigator using the shared
`forge-workspace.yaml` registry. The navigator combines a compact changes tree,
Type/Importance filters, signal inspection and a selected-entry metadata pane.
Executable: `forge`. Licensed under [MIT](LICENSE).

Registry `0.1.2` is the published server baseline; the configuration and API below
describe the current source. The React overview is unreleased.

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

The UI's `Components/WorkspaceReview/` composes a ChangesNavigator and an independent
SelectionViewer. Owned WorkspaceData and ChangeSetData separate workspace-context
reads from comparison analysis while sharing the existing Query mechanism. The
navigator owns tree projection/expansion; selection uses canonical comparison facts,
not filtered tree rows. Shared summaries belong to the review feature. See
[UI architecture](ui/docs/architecture.md) for the responsibility map.

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
The navigator is read-only. Select a file, folder or registered repository by its
name; select it again to clear. Direct links use `/?path=src/example.ts`, with
`/?path=.` for the workspace root. Back/Forward restores selection. Ctrl+Click
selects and copies the workspace-relative path. Disclosure controls expansion
independently; drag the divider or focus it and use Left/Right to resize.

Type and Importance combine with AND, with OR within each dimension. All types
and High/Medium/Low start enabled; None starts disabled. Classification and
effective importance come from server analysis. Header totals cover every changed
entry; visible/total file counts preserve the complete denominator, while sidebar
and subtree line totals follow the filters. Repository-owned counts exclude nested
repositories; subtree summaries include them. Binary and zero-line entries still
count as changes. Count tooltips show independent Type and Importance breakdowns.

Filtering preserves selected metadata, including rename sources, both-side ownership
and file/directory transitions. Empty and missing-at-startup registered repositories
remain selectable. Explicit Refresh preserves filters, expansion and useful selection;
a disappeared selection is explained after successful identity and analysis reads.
Failed reads preserve usable content and mark retained data stale, with independent
retry controls. File content and diff rendering remain future work.

Hover or focus a warning triangle or notice circle for the complete source/message
list, including filtered sources and nested repositories. Each severity is strong
for direct signals and subdued for descendant-only concerns. Click an indicator
to select its subject and open bounded signal details below the path header;
details retain handler IDs and optional base/current coordinates. Ordinary selection
and Back/Forward begin with a collapsed summary. Filters and Refresh preserve the
disclosure choice for a surviving subject.

Message paths select their canonical source and open its details while preserving
filters. A filtered changed source offers Reveal file: it enables only missing
Type/Importance categories, expands the source's ancestors and selects it with
details open. Other enabled categories and unrelated expansion survive. Repeating
inspection or reveal on the selected source reopens details without adding history.

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

The [analyzed tree](server/docs/protocol.md#analyze-workspace-changes) supplies
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

Modules load once at startup from validated workspace and rooted participant
ancestry; restart to reload them. Forge invokes each applicable hook once per
canonical node, merging workspace and both source-owner chains. Annotation hooks
can navigate and annotate the whole tree, so account for repeated invocation.
Extensions are trusted, unsandboxed code; await all work and cooperate with cancellation.

An applicable load error or hook failure rejects analysis atomically while light
APIs remain usable. An unrelated broken participant does not block analysis.
The [analysis guide](https://github.com/ZDreamer2/forge/blob/main/server/src/components/tree-analysis/docs/UnitGuide.md)
explains attribution, source capabilities and execution limits.
