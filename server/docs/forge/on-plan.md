# Forge application

This repository owns the `@zdreamer/forge` npm application and workspace-authoring
contract, not the agent plugin. Current placement and component boundaries are in
[architecture](../../../docs/architecture.md); consumption and limitations are in the
[README](../../../README.md). The service root is `server/`; installation,
publication and aggregate acceptance belong to the repository root. The server owns
its browser-safe API vocabulary in `server/src/components/api-contract/index.ts`; this is the public
entry available to UI source, not permission to import other server units. The
[HTTP API contract](../protocol.md) owns behavioral semantics. UI implementation is
not a server unit.
