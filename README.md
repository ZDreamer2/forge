# @zdreamer/forge

Provisional Forge workspace application. The unreleased source supports a
foreground read-only workspace server and the policy-loading diagnostic. Registry
release `0.1.1` supplies the diagnostic and policy types; it does not contain the
server. Executable: `forge`; public authoring types: `@zdreamer/forge/workspace`.
Licensed under [MIT](LICENSE).

The `0.x` policy contract is provisional. Breaking authoring or semantic changes
use a minor release with migration notes; exact-pin the application and use its
own policy types from the same installation. No separate policy-version field or
compatibility layer is provided. See [release operations](https://github.com/ZDreamer2/forge/blob/main/docs/releasing.md).

## Develop

Use Node 24.21.0 (`.nvmrc`) and Corepack pnpm 11.15.1:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --config.verify-deps-before-run=error run check
corepack pnpm --config.verify-deps-before-run=error run build
corepack pnpm --config.verify-deps-before-run=error run test:workspace
```

The independent installation uses published `@zdreamer/forge-ts-service@0.1.1`
presets, their exact-pinned tool peers, the seven-day third-party release-age
floor, and explicit SWC script permission. `.cache/pnpm` is the portable default;
a hosting checkout can override the store during installation.

`test:workspace` checks public types and the installed executable through an
isolated tarball consumer, without publishing or running install scripts. An
optional `workspace.ts` argument also checks a consuming project's policy.

## Run the source server

After building, run from this repository:

```sh
node dist/main.js serve --workspace /absolute/path/to/checkout
```

The CLI form is `forge serve --workspace <path>` once a server-capable release
is installed. Relative workspace paths resolve against the invocation directory;
the selected directory is canonicalized as the authoritative checkout.

Startup loads exactly `<guidance-folder>/workspace.ts`. The default folder is
`docs/forge/workspace` inside the selected checkout. A nonempty process
`ZD_AI_FORGE_WORKSPACE_GUIDE` selects a different folder, relative to that checkout
or absolute; `.env` cannot set this override. Invalid explicit choices fail
without ancestor search or fallback. The standalone server requires the trusted
TypeScript module, not the Python workflow's `on-plan.md`, `on-diff-route` or
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

The foreground process prints `http://127.0.0.1:<port>` after listener readiness.
`GET /api/workspace` returns the workspace root and declared available/missing
repositories in declaration order. Invalid existing repositories, Git/access
failures and policy/configuration errors refuse startup. Requests require that
exact Host and, when present, Origin; CLI requests may omit Origin. Restart to
reload configuration, policy and repository identity. Stop with SIGINT or
SIGTERM; shutdown closes the listener and releases the port.

`GET /api/changes` returns `{ changes: [...] }`: net HEAD-to-current-working-copy
changes, including non-ignored untracked files, independently of staging. Entries
carry repository ID, workspace-relative path, kind, optional rename/copy `from`,
binary status, added/removed line counts and concrete codebase memberships. Binary
counts are `null`; text metadata-only changes retain zero counts.

Collection reads fresh working content on each request using the startup policy
and participating repositories. Missing-at-startup repositories remain excluded;
loss of an available repository, Git/read failures or invalid/throwing routing
results fail the entire request. Paths stay inside the selected workspace even
when its main Git root extends above it. Nested repositories are distinct;
undeclared clones and Git internals are excluded. Temporary comparison state leaves
source files, indexes and objects unchanged. Startup executes trusted policy code.

For a direct check while the server runs, replace the example address with the
address printed by the server:

```sh
FORGE_ADDRESS=http://127.0.0.1:12345
curl "$FORGE_ADDRESS/api/workspace"
curl "$FORGE_ADDRESS/api/changes"
```

`/` still returns not found; this source has no browser page yet. Registry `0.1.1`
remains the diagnostic-only release.

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
exist, and includes both rename/copy sides. Several concrete codebases can share
guidance; membership does not imply verification.

Policy modules are trusted executable code, not sandboxed; installation does not
load them. The changes collector validates callback results at runtime; the diagnostic
uses the authored types without that validation. See
[architecture](https://github.com/ZDreamer2/forge/blob/main/docs/architecture.md) for loading limits and repository resolution,
which the diagnostic does not invoke.
