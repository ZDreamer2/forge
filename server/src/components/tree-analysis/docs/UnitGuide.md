---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# tree-analysis Guide

Runs trusted guide classification and annotation hooks over a per-request facade of a workspace tree.
Composition supplies loaded contributions; this component imports no extension
modules. Base facts remain shared with light requests, while classification, annotations and source
observations belong to one run. `http-api` supplies source access and cancellation.
The [shared extension contract](../../../../../../../../ai/bc-plugins/dev/forge/docs/theory/codebases/guide-part/extension/forge-extension.md)
owns authoring, guide identity and module compatibility.

## Scheduling and capabilities

Visit canonical nodes in deterministic preorder, including root, inferred directories,
deletions and symlinks. For each node, merge independent workspace, base-owner and
current-owner ancestry through `workspace-config`, preserving constraints with that
priority between eligible guides. Shared guides run once per node. Ownership comes
from actual sides, including both rename endpoints; unassigned nodes use workspace
ancestry alone. Contradictory cross-owner order fails analysis atomically.

Complete a classification traversal across the whole tree before starting the
annotation traversal. Each phase uses the same node preorder and applicable guide
order; every hook finishes before the next invocation. Contributions can provide
either hook, both or neither. The result inventory records actually invoked
identities once, in first-use order, without codebase ownership.

`classifyNode` receives readonly current canonical node facts, namespaced `guide.id`,
`signal` and `classify(value, reason?)`. This capability assigns only that target,
with `<guide>#classifyNode` provenance; it expires when its invocation settles or
the run is cancelled. The context has no navigation, source observations or
annotation methods. The [workspace-tree contract](../../workspace-tree/docs/UnitGuide.md#metadata)
owns category values, fallback, assignment semantics and runtime validation.

`annotateNode` context exposes current `node`, namespaced `guide.id`, `signal` and
`source`. Nodes provide readonly facts, parent/children navigation and synchronous
preorder `walk()` including self. Hooks can inspect completed classification and
annotate any reachable node, so repeated invocations can duplicate cross-node
effects. Each write receives `<guide>#annotateNode` provenance. Node-side owner facts
retain stable ID, root and guide. Derived emphasis/totals are finalized only after
both phases succeed.

No policy is intrinsic to the engine. Without adopted hooks, classification stays
Code, emphasis stays normal and signals remain empty; Forge-base owns its path
classification, planning/test emphasis and Markdown-warning policies.

## Source facts and lifecycle

`source.currentByteSize(node)` observes only current regular files belonging to the
run, without exposing content. Pending, successful and failed observations are cached.
The capability permits at most two simultaneous observations even if a trusted hook
fans out across the tree. Cancellation stops queued reads and later effects.

An applicable retained load error or invocation failure rejects the whole analysis;
light requests remain usable. Safe guide/hook identities reach clients, while raw
causes remain in server diagnostics. Invocation errors identify the actual hook;
retained load errors use the first phase's `#classifyNode` identity even when the
broken export's hook set is unknown. A classifier failure, including an invalid
runtime category, prevents annotation and exposes no partial analysis.
Cancellation races async work, observes late rejection and prevents later
invocations and finalization. Run capabilities become
invalid after completion or cancellation.

Startup-loaded functions can serve concurrent requests. Authors keep state local,
await all work and stop using capabilities when their invocation returns. Trusted
JavaScript is not sandboxed: cancellation cannot preempt synchronous execution or
police detached callbacks. Hooks have no supplied source-write or exec capability.
