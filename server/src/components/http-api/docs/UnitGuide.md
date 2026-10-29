# http-api Guide

Owns domain HTTP endpoints, selecting sources and mapping domain results into
browser-safe `api-contract` shapes. It is the component combining source collection
with analysis; domain rules remain with their respective owners.

`/changes` projects shared base collection into a flat change list and never runs
handlers. `/changes/analysis` waits for that collection under an app-owned request
budget, then starts an independent analysis run. It supplies the source's narrow
current-size capability for nodes of that collected tree. Cancellation cannot
cancel another request's shared collection. `app` owns admission, controllers,
shutdown, mounting and Host/Origin protection. Source size operations register with
that request owner: settling or cancelling a run aborts and drains its source
probes before disposal completes. Arbitrary authored-handler promises may still
be abandoned when they do not cooperate.

The analysis mapping emits a path-indexed node table with explicit root and child
adjacency. It translates owner and handler references into response-local
definitions, preserving safe literal keys. Direct annotations remain on their
nodes; finalized totals, effective emphasis and inclusive signal counts carry the
server's structural meaning to clients. The [API contract](../../../../docs/protocol.md)
owns the wire semantics and safe handler-error envelope. GET and HEAD remain
read-only toward workspace and Git state; trusted modules are not sandboxed.
