# Forge application architecture

Forge interprets one authoritative workspace checkout and exposes it to browser and
CLI clients. Workspace interpretation and operations belong to the server; clients
own presentation rather than reconstructing repository participation or codebase
membership. Runtime-dependent project checks may delegate elsewhere without moving
that authority away from the checkout.

## Application boundaries

One package, `@zdreamer/forge`, and one root installation own dependencies,
aggregate acceptance and distribution. Its source boundaries are:

- `server/`: workspace authority, its public API contract, HTTP access and process
  lifecycle.
- `ui/`: the standalone React frontend, currently reserved. The working vanilla
  diagnostic remains server-owned; it is not the React application.

Server and frontend are distinct codebases with different runtime and verification
requirements despite sharing an installation. The UI consumes the server's public
`api-contract` entry, never server internals. This contract is browser-safe vocabulary
without Node globals, implementation dependencies or UI frameworks; it is owned by
the server, not a third codebase. Server domain results are mapped into wire shapes;
neither domain internals nor workspace configuration become browser APIs.
Workspace configuration is the `forge-workspace.yaml` registry Python Forge also
reads; the earlier `workspace.ts` policy and its public `./workspace` authoring
export are removed by migration, without a legacy path.

The [HTTP API contract](../server/docs/protocol.md) owns observable behavior and
unresolved API semantics. The [README](../README.md) owns source layout, supported capabilities,
configuration, package entry paths and development commands.

## Server components

The map below is the baseline for server work. Components live under
`server/src/components/`; each new baseline component has `docs/UnitGuide.md` with
its design context.

| Component | Responsibility | Outgoing component imports |
| --- | --- | --- |
| `workspace-config` | Trusted authored workspace knowledge: registered codebases, declared repositories, display name, handler references | None |
| `workspace-repositories` | Observed participating repositories: startup resolution, status, path participation | workspace-config |
| `workspace-tree` | Tree vocabulary and data: nodes, sides, owners, repository/codebase roots, fixed review metadata, building and derived values | workspace-config |
| `tree-sources` | Builds base trees from sources of workspace state, with bounded source capabilities | workspace-tree, workspace-repositories, workspace-config |
| `tree-analysis` | Runs ordered trusted handlers over a run-local tree facade and finalizes review metadata | workspace-tree, workspace-config |
| `http-api` | Domain endpoints: selects a source, builds and analyzes its tree, maps results to the wire contract | tree-sources, tree-analysis, workspace-tree, workspace-repositories, workspace-config, api-contract |
| `api-contract` | Browser-safe wire vocabulary consumed by server and UI; contract changes also require consumer verification | None |
| `diagnostic-ui` | Minimal diagnostic page; its browser code consumes the HTTP API | None |

The workspace tree is the shared base. Sources produce trees; analysis enriches any
tree without knowing its source; `http-api` is the only component combining them.
Authored knowledge (`workspace-config`) stays separate from observed Git state
(`workspace-repositories`, `tree-sources`). Clients receive structural meaning,
ownership, totals and review metadata from the server rather than deriving them.

`app` reads process configuration, constructs instances, mounts routes, assembles
protected HTTP access and owns shared in-flight work and startup/shutdown. `lib/git`
owns bounded Git process and cancellation mechanics and plain Git operations that
need no workspace knowledge; `lib/loopback-access` owns the Host/Origin guard. HTTP
knowledge stays in `http-api`, diagnostic routes, loopback middleware and HTTP
assembly. Domain components do not construct each other or read process
configuration; composition supplies their dependencies.

Current implementation includes configuration, repository participation, the canonical
workspace tree, working changes, ordered analysis handlers and identity/flat/analyzed
changes HTTP routes. The machine-checked component edges match these owners.
Sources supply narrow current-file byte sizes; full content readers remain deferred.

## Authority, trust and lifecycle

Authored configuration and repository participation are loaded at startup and
replaced on restart. The server probes declared repositories rather than scanning for additional clones;
missing-at-startup repositories remain excluded, while loss of an available
repository fails collection instead of silently reducing the result.

Refresh observes current Git state within that startup context. Overlapping requests may share base collection, while each analysis request owns
its facade, annotations and final derived values; results are live observations, not cached trees or
atomic cross-repository snapshots. The practical HEAD/working
comparison is not staging equivalence or a replacement for durable capture and
checking/staging. Future migration must align their participation and scope before
sharing authority.

Workspace inspection is read-only with respect to source files and Git metadata.
Authored configuration is data; analysis handlers and Git filters are trusted executable code, not an effects sandbox;
HTTP protection does not change that trust model. File access remains within the
selected workspace even when its containing Git root extends above it.

Application composition owns the listener, termination hooks and active collection and analysis runs.
Overlapping requests share in-flight base work, not cached results, and one client
leaving cancels only its own analysis. Analysis has a 30-second total budget,
including collection waiting; cooperative cancellation releases an awaited handler
without preempting synchronous trusted JavaScript. App-owned source observations
remain tracked through cancellation and subprocess reaping. Shutdown stops admission, cancels and reaps
owned Git work, and closes connections within finite bounds. Transport and process
resources do not outlive their application owner.
