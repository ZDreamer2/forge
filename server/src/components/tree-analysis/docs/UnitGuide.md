---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# tree-analysis Guide

Runs trusted guide annotation hooks over a per-request facade of a workspace tree.
Composition supplies loaded contributions; this component imports no extension
modules. Base facts remain shared with light requests, while annotations and source
observations belong to one run. `http-api` supplies source access and cancellation.
The [shared extension contract](../../../../../../../../ai/bc-plugins/dev/forge/docs/theory/codebases/guide-part/extension/forge-extension.md)
owns authoring, guide identity and module compatibility.

## Scheduling and annotation

Visit canonical nodes in deterministic preorder, including root, inferred directories,
deletions and symlinks. For each node, merge independent workspace, base-owner and
current-owner ancestry through `workspace-config`, preserving constraints with that
priority between eligible guides. Shared guides run once per node. Ownership comes
from actual sides, including both rename endpoints; unassigned nodes use workspace
ancestry alone. Contradictory cross-owner order fails analysis atomically.

Each applicable `annotateNode` finishes before the next invocation. Context exposes
current `node`, namespaced `guide.id`, `signal` and `source`. Whole-tree navigation
and cross-node annotations remain available; repeated calls require authors to avoid
unintended duplicate effects. Each write receives `<guide>#annotateNode` provenance.
The result inventory records actually invoked identities once, in first-use order,
without codebase ownership. Node-side owner facts retain stable ID, root and guide.

Nodes provide readonly facts, parent/children navigation and synchronous preorder
`walk()` including self. Rename topology follows the destination path. Hooks read
direct annotations; derived metadata is finalized only after successful execution.
`deemphasize`, `restoreNormalEmphasis`, `emphasize` and `hide` set emphasis; later
writes win on a node, and the nearest explicit ancestor controls inheritance. A normal
reset restores attention beneath hidden/deemphasized ancestry. `warn` and `notice`
accumulate visible signals with optional one-based side/line/column locations.

No policy is intrinsic to the engine. Without adopted hooks, emphasis stays normal
and signals remain empty; Forge-base owns its planning/test and Markdown policies.

## Source facts and lifecycle

`source.currentByteSize(node)` observes only current regular files belonging to the
run, without exposing content. Pending, successful and failed observations are cached.
The capability permits at most two simultaneous observations even if a trusted hook
fans out across the tree. Cancellation stops queued reads and later effects.

An applicable retained load error or invocation failure rejects the whole analysis;
light requests remain usable. Safe guide/hook identities reach clients, while raw
causes remain in server diagnostics. Cancellation races async work, observes late
rejection and prevents later invocations and finalization. Run capabilities become
invalid after completion or cancellation.

Startup-loaded functions can serve concurrent requests. Authors keep state local,
await all work and stop using capabilities when their invocation returns. Trusted
JavaScript is not sandboxed: cancellation cannot preempt synchronous execution or
police detached callbacks. Hooks have no supplied source-write or exec capability.
