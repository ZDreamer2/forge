# Forge application prototype

The npm package contains compiled JavaScript and declarations from `dist/`,
with no install/pack lifecycle hooks. The `workspace-policy` component owns policy
types, trusted-module loading and declared-repository probes. Its loader and
resolver are internal application APIs; `src/workspace.ts` exposes only public
authoring types through `./workspace`.

Loading executes trusted project code through Node's module cache. It validates
the default export's routing function and unique normalized repository paths,
not callback results. There is no sandbox or hot reload. The [README](../README.md)
owns the authoring and consumption contract.

`src/app/inspect.ts` assembles the diagnostic. `src/main.ts` owns CLI arguments,
output and exit status. Its membership diagnostic is lexical and does not invoke
repository probes. `resolveRepositories` probes only declared locations and
returns `available`/`missing` results; existing invalid locations and Git/access
failures are errors. The main Git root may lie above the workspace; nested
locations need their own Git root and cannot escape the workspace via symlinks.
Startup/explicit reload is the intended integration point, not change-list
polling; no server lifecycle is wired yet. The public facade is the sole
source-root exception to the shared service structure.

The policy contract is provisional until server consumption and separate from
HTTP schemas.
