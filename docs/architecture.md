# Forge application architecture

Forge interprets one authoritative workspace checkout and exposes it to browser and
CLI clients. Workspace interpretation and operations belong to the server; clients
own presentation rather than reconstructing repository participation or codebase
membership.

## Application boundaries

One package, `@zdreamer/forge`, and one root installation own dependencies,
aggregate acceptance and distribution. Its source boundaries are:

- `server/`: workspace authority, its public API contract, HTTP access and process
  lifecycle.
- `ui/`: the standalone React workspace review, owning browser presentation, data
  access, providers and recovery. Vite bundles it into the distributed package.

Server and frontend are distinct codebases with different runtime and verification
requirements despite sharing an installation. The UI imports only the server's
public `api-contract` entry: browser-safe wire vocabulary mapped from domain
results, with no server implementation or configuration exposed.
Workspace configuration is the `forge-workspace.yaml` registry Python Forge also
reads.

The [HTTP API contract](../server/docs/protocol.md) owns observable behavior;
the [README](../README.md) owns configuration and development commands.

## Server components

The map below is the baseline for server work. Components live under
`server/src/components/`; each new baseline component has `docs/UnitGuide.md` with
its design context.

| Component | Responsibility | Outgoing component imports |
| --- | --- | --- |
| `workspace-config` | Trusted authored workspace knowledge: registered codebases, declared repositories, display name and guide composition | None |
| `workspace-repositories` | Observed participating repositories: startup resolution, status, path participation | workspace-config |
| `workspace-tree` | Canonical tree vocabulary, ownership and derived review data | workspace-config |
| `tree-sources` | Builds base trees from sources of workspace state, with bounded source capabilities | workspace-tree, workspace-repositories, workspace-config |
| `tree-analysis` | Schedules applicable guide hooks per node over a run-local tree facade and finalizes review metadata | workspace-tree, workspace-config |
| `guide-extensions` | Discovers and validates trusted guide modules; publishes the authoring contract listing engine-known hooks | workspace-config, tree-analysis |
| `http-api` | Domain endpoints: selects a source, builds and analyzes its tree, maps results to the wire contract | tree-sources, tree-analysis, workspace-tree, workspace-repositories, workspace-config, api-contract |
| `api-contract` | Browser-safe wire vocabulary consumed by server and UI; contract changes also require consumer verification | None |
| `ui-assets` | Delivers installed HTML and bundled assets through protected HTTP routes | None |

The workspace tree is the shared base. Sources produce trees; analysis enriches any
tree without knowing its source; `http-api` is the only component combining them.
Authored knowledge (`workspace-config`) stays separate from observed Git state
(`workspace-repositories`, `tree-sources`). Clients receive structural meaning,
ownership, line totals and review metadata from the server; the UI may derive
display projections from that vocabulary.

`app` constructs components and owns HTTP assembly and process configuration.
`lib/git` owns bounded Git processes and cancellation; `lib/loopback-access` owns
the Host/Origin guard. Domain components receive dependencies from composition.

`guide-extensions` publishes the type-only authoring API at
`@zdreamer/forge/extension`, separately from engine loading operations. Hook execution
owners define their capability contracts; `guide-extensions` composes them, never
the reverse. Loader, runner and configuration internals remain private.

## UI ownership

[UI architecture](../ui/docs/architecture.md) owns frontend component/data
responsibilities, selection and navigator boundaries, and derived presentation
state. This document owns the application-wide authority and lifecycle boundaries.

## Installed browser host

The server serves bundled UI and API from one protected origin. Assets resolve
relative to the installed package, independent of the invocation directory.
Static delivery has no workspace-data responsibility.

## Authority, trust and lifecycle

Authored configuration and repository participation are loaded at startup and
replaced on restart. Missing-at-startup repositories stay excluded; loss of an
available repository fails collection instead of silently reducing the result.

Refresh observes current Git state within that startup context. Overlapping
requests share in-flight source discovery, cleared on settlement. The source owns
finalized membership, sides and comparison context; each request owns statistics
materialization and derived state. Results are live observations without atomic
cross-repository snapshots. Discovery scope does not authorize broader dirt
capture, checking or staging.

Inspection preserves source and Git index/ref/object contents. Authored YAML is
data; analysis handlers and Git filters are trusted executable code outside that
effects guarantee. File access stays within the selected workspace even when its
Git root extends above it. Precise effects and limits belong to the API contract.

Application composition owns the listener and active operations. One client leaving
cancels only its own work; shutdown stops admission, cancels/reaps owned processes
and releases resources within finite bounds.
