# http-api Guide

Owns domain HTTP endpoints, selecting sources and mapping domain results into
browser-safe `api-contract` shapes. It combines sources with analysis; domain
rules remain with their respective owners.

Change routes await shared fresh discovery under independent app-owned request
budgets. After discovery, each route checks its signal before starting source work.
Statistics materialization, patch acquisition and source-size probes register with
the request owner for abort and drain before disposal. Shared discovery remains
independently owned; arbitrary authored-handler promises may be abandoned when
they do not cooperate. `app` owns admission, controllers, shutdown, mounting and
Host/Origin protection.

`/changes` materializes a complete tree before projecting a flat change list,
without handlers. `/changes/analysis` also materializes complete statistics before
running handlers. Its current-size capability authorizes nodes from that same
materialized tree.

The file route validates literal canonical paths and optional short/all context,
then requests selected statistics and patch acquisition directly from discovery.
The [source](../../tree-sources/docs/UnitGuide.md) owns membership, side ownership
and finalized comparison context; HTTP maps those facts without constructing an
incomplete analysis tree. Excluded participation maps to forbidden; operational
failures become sanitized internal errors.

At startup, `resolveWorkspaceGuidance` validates and projects the
`workspace-config` composition for the workspace and every rooted participant.
`app` retains and injects this wire snapshot; analysis serializes it without
per-request resolution. Ordering remains owned by `workspace-config`.

Analysis mapping supplies explicit root/child adjacency and response-local owner
and handler definitions, preserving safe literal keys. The
[API contract](../../../../docs/protocol.md) owns wire shapes, operation-scoped
statistics failures, context semantics, limits and read-only effects.
