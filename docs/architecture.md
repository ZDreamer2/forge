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
neither domain internals nor workspace-authoring types become browser APIs. The
public `./workspace` export exposes policy-authoring types independently of the
HTTP contract and operational policy loader.

The [HTTP API contract](../server/docs/protocol.md) owns observable behavior and
unresolved API semantics. The [README](../README.md) owns source layout, supported capabilities,
configuration, package entry paths and development commands.

## Server responsibilities

- `api-contract` owns the public wire vocabulary consumed by server routes and UI.
  It is independent of operational server components; browser safety is verified
  as part of server acceptance. Contract changes also require consumer verification.
- `workspace-policy` interprets trusted authored policy and resolves declared
  repositories into startup context. It owns project knowledge, not HTTP or change
  collection.
- `workspace-changes` owns HTTP-independent Git comparison and codebase membership
  for the selected workspace. It consumes policy context rather than discovering a
  second set of participating repositories.
- `app` composes capabilities, maps results to the protocol, assembles protected
  HTTP access and owns startup/shutdown. It also owns the thin identity/change
  routes and shared collection lifecycle rather than introducing a separate API
  component for this diagnostic slice.
- `diagnostic-ui` owns the minimal diagnostic page. Its browser code consumes the
  HTTP API; it has no domain-component dependencies.

The domain-component edge is `workspace-changes -> workspace-policy`; other
component edges are forbidden. Technical Git execution and loopback-access
capabilities stay below these responsibilities. Git execution owns bounded process
and cancellation mechanics; HTTP knowledge stays at HTTP assembly, diagnostic
routes and loopback middleware. Domain components do not construct each other or
read process configuration; composition supplies their dependencies.

## Authority, trust and lifecycle

Policy and repository participation are loaded at startup and replaced on restart.
The server probes declared repositories rather than scanning for additional clones;
missing-at-startup repositories remain excluded, while loss of an available
repository fails collection instead of silently reducing the result.

Refresh observes current Git state within that startup context. Results are live
observations, not atomic cross-repository snapshots. The practical HEAD/working
comparison is not staging equivalence or a replacement for durable capture and
checking/staging. Future migration must align their participation and scope before
sharing authority.

Workspace inspection is read-only with respect to source files and Git metadata.
Authored policy and Git filters are trusted executable code, not an effects sandbox;
HTTP protection does not change that trust model. File access remains within the
selected workspace even when its containing Git root extends above it.

Application composition owns the listener, termination hooks and active collection.
Overlapping requests share in-flight work, not cached results, and one client
leaving does not cancel the others. Shutdown stops admission, cancels and reaps
owned Git work, and closes connections within finite bounds. Transport and process
resources do not outlive their application owner.
