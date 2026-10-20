# Forge application architecture

The npm package contains compiled JavaScript and declarations from `dist/`, with
no install/pack lifecycle hooks. `src/workspace.ts` exposes only public authoring
types through `./workspace`; this facade is the sole source-root exception to the
shared service structure. The provisional policy contract is separate from HTTP
schemas. The [README](../README.md) owns startup, authoring and consumption.

## Responsibilities and dependencies

- `app/` reads configuration once, loads the trusted policy and probes declared
  repositories into one startup snapshot, assembles HTTP, and owns listening and
  disposal. It constructs effectful capabilities and passes explicit inputs to
  units. `main.ts` owns CLI arguments, terminal formatting and exit status.
- `workspace-api` owns HTTP wire vocabulary, identity/change mapping and
  prefix-relative routes. Its permitted edges are `workspace-api -> workspace-policy`
  for identity inputs and `workspace-api -> workspace-changes` for collection
  results and dependencies. It receives the collector rather than constructing it.
- `workspace-changes` owns HTTP-independent HEAD/current collection, repository
  and workspace boundaries, comparison metadata and membership validation. Its
  permitted edge is `workspace-changes -> workspace-policy`. Git subprocesses and
  temporary comparison state remain internal; source files, indexes and objects
  are read-only.
- `workspace-policy` owns policy authoring types, trusted-module loading and
  declared-repository probes. Its loader and resolver are internal application
  APIs, separate from the public types-only facade.
- `lib/loopback-access` owns domain-free request authority/origin checks and typed
  access rejection. HTTP assembly translates rejection into the API envelope;
  the library does not depend on component wire vocabulary.

The component graph is acyclic; unlisted component edges are forbidden. Units do
not instantiate each other or read environment settings. Hono is confined to HTTP
assembly, workspace API routes and loopback access middleware; `@hono/node-server`
is confined to `app/listener.ts`.

## Startup snapshot and lifecycle

Loading executes trusted project code through Node's module cache. The loader
validates the default export's routing function and unique normalized repository
paths, not callback results. There is no sandbox or hot reload.

`resolveRepositories` probes only declared locations and returns
`available`/`missing` results. Existing invalid locations and Git/access failures
refuse startup. The main Git root may lie above the workspace; nested locations
need their own Git root and cannot escape the workspace via symlinks. Restart
reloads configuration, policy and repository identity; requests reuse that
snapshot. Identity roots are descriptive metadata; change collection scopes
paths before content reads and comparison, staying inside the workspace and
excluding nested repository contents from their ancestors. Each collection reads
fresh working content using isolated temporary index/object state. Missing-at-startup
repositories stay excluded; loss of an available repository fails collection.

HTTP assembly is socket-free. The listener owns readiness, bind errors and
idempotent asynchronous close; startup owns termination hooks and their removal.
Shutdown drains HTTP connections for a finite period before closing remaining
sockets. The listener's internal timeout is documented beside its implementation.

`src/app/inspect.ts` assembles the existing lexical membership diagnostic without
repository probes. The server exposes identity and current changes; no browser
page is served yet.
