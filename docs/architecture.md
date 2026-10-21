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
- `diagnostic-ui` owns the fixed diagnostic HTML and vanilla browser script at `/`.
  It has no component dependencies; browser requests consume the existing API.
- `app/` also owns the thin identity/change HTTP routes, wire vocabulary and
  mapping, request protections and active-collection lifecycle in flat files. This
  topology overrides the shared guidance's default component ownership for domain endpoints here.
- `workspace-changes` owns HTTP-independent bulk HEAD/working comparison plus
  untracked listing and targeted same-path reconciliation, workspace/nested
  boundaries, policy mapping and response-local codebase-definition consistency.
  Its sole component edge is `workspace-changes -> workspace-policy`. It returns
  four legacy-compatible kinds, ID references and one definition index.
- `workspace-policy` owns policy authoring types, trusted-module loading and
  declared-repository probes. Its `authoring` sub-unit exposes node-free types to
  the public facade without traversing loader/probe declarations. Its loader and
  resolver are internal application APIs.
- `lib/git` owns sanitized Git execution, bounded output/deadlines and
  child cancellation/reaping for repository probes and collection.
- `lib/loopback-access` owns domain-free request authority/origin checks and typed
  access rejection. HTTP assembly translates rejection into the API envelope;
  the library does not depend on component wire vocabulary.

The component graph is acyclic; unlisted component edges are forbidden. Units do
not instantiate each other or read environment settings. Hono is confined to HTTP
assembly/app routes, diagnostic UI routes and loopback access middleware; `@hono/node-server`
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
snapshot. Identity roots are descriptive metadata. Scope bulk comparison/untracked/conflict
commands before traversal to the workspace portion and declared nested exclusions;
validate candidate ancestors and rename endpoints without a full filesystem scan.
Each collection runs at most two repositories concurrently, with serial Git commands
within each repository. It buffers results and invokes synchronous policy callbacks
in declaration order. The first repository failure aborts peers; collection joins
both lanes before returning that failure. Every Refresh revalidates the canonical
root and object-store location in one framed probe, then inspects current config
and promisor pack markers before object-demanding commands. A tagged NUL listing
collects conflicts and untracked paths together before HEAD resolution.
Each collection compares HEAD (empty baseline if unborn) using one bulk
`diff --raw --numstat -z --no-abbrev --find-renames --no-ext-diff --no-textconv
--ignore-submodules=all <baseline> -- <scope>` invocation. The shared Git prefix
sets `diff.autoRefreshIndex=false`: raw-only diff otherwise refreshes and can write
the source index when cancelling staged reversals. Parse the raw section followed
by NUL-delimited numstat records, including rename pairs and binary markers.
Suppress only same-mode worktree M records with a zero new OID and no matching
numstat entry; structural and mode changes, zero counts and binary markers remain.
Counts stay internal. Reconcile only same-path non-ignored deletion/rename-source
restorations with literal HEAD lookup and normalized hash without writes. Git owns index flags/modes/normalization.
Trust ordinary filters; disable external diff/textconv and optional Git writes.
Reject partial/promisor repositories before comparison; forbid silent lazy fetch.
This is not an effects sandbox for trusted filters or policy code. No synthetic
trees, private index/object engine or exhaustive hashing. Missing-at-startup repos
stay excluded; losing an available repository fails collection.

HTTP assembly is socket-free. The listener owns readiness, bind errors and
idempotent asynchronous close; startup owns termination hooks and their removal.
Startup shares one active collection promise across requests. Shutdown stops
admission, aborts collection, reaps owned Git children and drains HTTP connections
for a finite period before closing remaining sockets. The listener's internal timeout is documented beside its implementation.

`src/app/inspect.ts` assembles the existing lexical membership diagnostic without
repository probes. The server exposes identity and current changes plus a diagnostic browser page.
Refresh collects current state; restart reloads policy and repository participation.
