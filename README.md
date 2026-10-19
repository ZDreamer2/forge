# @zdreamer/forge

Provisional prototype of the Forge workspace application: a policy-loading
diagnostic, not a server or review UI. Executable: `forge`; public authoring
types: `@zdreamer/forge/workspace`. Licensed under [MIT](LICENSE).

The `0.x` policy contract is provisional. Breaking authoring or semantic changes
use a minor release with migration notes; exact-pin the application and use its
own policy types from the same installation. No separate policy-version field or
compatibility layer is provided. See [release operations](https://github.com/ZDreamer2/forge/blob/master/docs/releasing.md).

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

## Workspace authoring contract (provisional)

Projects can exact-pin Forge as a local development dependency:

```sh
pnpm add --save-dev --save-exact @zdreamer/forge@0.1.0
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
load them. Types do not validate callback results at runtime. See
[architecture](https://github.com/ZDreamer2/forge/blob/master/docs/architecture.md) for loading limits and repository resolution,
which the diagnostic does not invoke.
