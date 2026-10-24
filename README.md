# @zdreamer/forge

Provisional Forge workspace application. The unreleased source supports a
foreground read-only workspace server, a minimal browser diagnostic and the
policy-loading diagnostic. Registry release `0.1.1` supplies the diagnostic and policy types; it does not contain the
server. Executable: `forge`; public authoring types: `@zdreamer/forge/workspace`.
Licensed under [MIT](LICENSE).

The `0.x` policy contract is provisional. Breaking authoring or semantic changes
use a minor release with migration notes; exact-pin the application and use its
own policy types from the same installation. No separate policy-version field or
compatibility layer is provided. See [release operations](https://github.com/ZDreamer2/forge/blob/main/docs/releasing.md).

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

`test:workspace` checks public types and the installed executable through an
isolated tarball consumer, without publishing or running install scripts. An
optional `workspace.ts` argument also checks a consuming project's policy. Run
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

Startup loads exactly `<guidance-folder>/workspace.ts`. The default folder is
`docs/forge/workspace` inside the selected checkout. A nonempty process
`ZD_AI_FORGE_WORKSPACE_GUIDE` selects a different folder, relative to that checkout
or absolute; `.env` cannot set this override. Invalid explicit choices fail
without ancestor search or fallback. The standalone server requires the trusted
TypeScript module, not the Python workflow's `on-codebase-selection.md`, `on-diff-route` or
`config.yaml` entries. External trusted guidance folders are allowed.

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
The `inspect-workspace` diagnostic retains its JSON-only stdout contract.
Open that address to see workspace/repository identity and current changed files,
including Git-reported rename sources and concrete
codebase memberships. Workspace names, paths and guidance are displayed literally
as text. The browser title uses `🛠️ <workspace name>` from server identity;
it starts as `Forge` and returns to `Forge` when the identity request fails.
The page shows loading, empty and error states; Refresh retries failed requests and clears the
previous change list while loading. Successful workspace identity is retained
when a request fails. Refresh reads current changes but does not reload startup
policy or repository participation. There is no polling.

`GET /api/workspace` returns the workspace root, resolved display name and declared
available/missing repositories in declaration order. Invalid existing repositories, Git/access
failures and policy/configuration errors refuse startup. Requests require that
exact Host and, when present, Origin; CLI requests may omit Origin. Restart to
reload configuration, policy and repository identity. Stop with SIGINT or
SIGTERM; shutdown closes the listener and releases the port.

`GET /api/changes` returns
`{ codebases: { id: { guidance: "path" } }, changes: [...] }`. Changes carry repo,
workspace-relative path, added/modified/deleted/renamed kind, optional rename
`from` and unique codebase ID arrays. Definitions occur once per response;
conflicting guidance for one ID fails collection. No binary/line counts.

Comparison uses one bulk HEAD/working `diff --raw --numstat -z` and non-ignored untracked listing,
with targeted normalized hash/mode reconciliation for recreated deletion/rename
sources. Index refresh is disabled; numstat presence removes raw stat noise while
mode/type changes, zero-count changes and binaries remain. Counts stay internal.
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
commands do not stage/commit/write indexes, refs or objects. Trusted policy and
filters can execute code with side effects; this is not an effects sandbox.

Missing-at-startup repositories remain excluded; loss of an available repository,
Git failures or invalid/throwing routing results fail the whole request. Paths
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
```

The server and browser page are read-only: no staging, commits, diff rendering,
file browsing or agent interaction. Registry `0.1.1` remains the diagnostic-only
release; source and installed-tarball verification do not constitute publication
or registry adoption.

## Workspace authoring contract (provisional)

Projects can exact-pin Forge as a local development dependency:

```sh
pnpm add --save-dev --save-exact @zdreamer/forge@0.1.1
```

```ts
import type { WorkspacePolicy } from '@zdreamer/forge/workspace';

export default {
  repositories: [{ path: '.' }, { path: 'tools/optional-checkout' }],
  codebasesForChange: () => [{ id: 'application', guidance: 'docs/code' }],
} satisfies WorkspacePolicy;
```

The unreleased source also accepts optional `displayName` policy metadata. An
explicit value must be a nonempty string and is preserved exactly, without
trimming or HTML interpretation. The server resolves an omitted name to the
canonical workspace root's basename, or the root itself if it has no basename,
and returns it as `workspace.name` in identity. Restart to reload the name.
Registry `0.1.1` does not declare this field in its authoring types. To retain
metadata while typechecking against that exact pin, use a structurally checked
variable:

```ts
const policy = {
  displayName: 'Example workspace',
  repositories: [{ path: '.' }],
  codebasesForChange: () => [],
};
export default policy satisfies WorkspacePolicy;
```

Module lookup follows the workspace file's ancestors, not the executable's
installation. A global executable alone does not supply editor/typechecker
resolution. Keep the dependency in an installation above the workspace module;
an isolated installation beside that module is also sufficient.

The current diagnostic command loads a selected trusted module explicitly:

```sh
forge inspect-workspace /absolute/path/workspace.ts . src/example.ts
# Optional last argument: previous path of a rename.
```

Repository IDs use `.` for the main repo and normalized workspace-relative POSIX
paths for nested repos. Change paths are workspace-relative; legacy CLI changes
can include `../` paths when the main Git root lies above the workspace.
`codebasesForChange` resolves membership lexically, without requiring files to
exist, and includes both rename sides. Several concrete codebases can share
guidance; membership does not imply verification.

Policy modules are trusted executable code, not sandboxed; installation does not
load them. The changes collector validates callback results at runtime; the diagnostic
uses the authored types without that validation. See
[architecture](https://github.com/ZDreamer2/forge/blob/main/docs/architecture.md) for loading limits and repository resolution,
which the diagnostic does not invoke.
