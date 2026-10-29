# workspace-tree Guide

Vocabulary and data structure for a tree of workspace paths that sources build and analysis enriches. The same tree serves current changes, merge requests and the project tree, so review views share one model of nodes, ownership and metadata.

## Notes

`index.ts` exposes the request-local `WorkspaceTree`, its insertion vocabulary and `createWorkspaceTree`. Insertion resolves owners from explicit startup context. `nodes` includes real directory ancestors; `entries` retains source insertion order. `totals(path)` derives basic numeric added/removed line totals from current entry data. Analysis uses a separate run facade and final pass; arbitrary custom totals remain deferred.

### Nodes

Node identity is the workspace-relative POSIX path; `.` is the root and stands for the whole workspace or changeset. Facts about the whole changeset attach to the root, facts about a codebase to its root directory.

Node kinds are `directory`, `file` and `symlink`. Repository and codebase roots are labels on directory nodes, not node kinds: one directory is often several at once, and the workspace root is typically all of them. There are no virtual grouping nodes; views such as grouping by codebase are projections of path nodes.

A tree records its two sides, such as HEAD and the working copy or two commits. A change on a node is `added`, `modified`, `deleted` or `renamed`. A rename is one node at the new path carrying its previous path and the source-owned `renameContentChanged` fact, never two linked nodes, so metadata and totals have exactly one place. A deleted node sits at its old path and exists only on the base side.

Owners (repository and codebase) are resolved here per side from registered roots by the closest-root rule; clients never resolve membership. A rename across codebases belongs to both sides' codebases.

### Metadata

The metadata set is fixed: emphasis (`emphasized`, `normal`, `deemphasized`, `hidden`, with reasons), signals (severity, message, source) and totals. Handlers express themselves through this set. A new kind is a deliberate change across this unit, `api-contract` and the UI, because each kind needs a wire shape and a rendering. Metadata records which handler produced it; it may later reference server-owned overview documents explaining it.

Emphasis applies to a subtree, and the nearest explicit setting wins, so an important subtree can contain unimportant ones such as tests deeper down. Direct signal payloads stay on their origin node. Inclusive severity counts summarize them on ancestors and remain visible through de-emphasis.

After all handlers finish, `finalizeAnalysis` propagates effective emphasis from parent to child and aggregates raw/attention-filtered added and removed totals and inclusive signal counts bottom-up. Effective emphasis retains handler, reason and explicit origin; default normal has no invented handler. The nearest explicit setting wins, including a normal reset beneath hidden/deemphasized ancestry. Handlers read direct annotations rather than stale derived values. Basic line totals cover every node including directories and the root. Renames count once along the destination path; former ancestry is retained for context with no duplicated file entry or counts. Binary entries contribute no fabricated text counts. Attention-filtered totals exclude effectively hidden/deemphasized entries. A file/directory transition contributes both its own statistics and its descendants.

### Shape

Light operations use the base tree without running analysis. `createAnalysisTree` builds one per-run facade/topology over its canonical source facts; it projects owner identity without executable handler descriptors. Each analysis node provides readonly parent/children navigation and synchronous preorder `walk()` including self. Root has no parent; rename topology uses the canonical destination path. Annotation methods attach the active handler identity without mutating the base.

A tree is built incrementally per request through `insert()`. Its live `nodes` and `entries` views allow reading, not independent structural edits: insertion owns node identity, side ownership and synchronization of the map and ordered entries. Statistics remain writable on base nodes. Analysis views expose readonly copies of statistics and sides, while each run owns separate annotations; simultaneous analyses and light projections cannot share mutable annotation state. These are TypeScript API constraints, not a runtime sandbox for trusted code.

Classes are data-only under the service conventions: methods operate on their own fields, without dependencies or I/O. Source access is a capability supplied separately, not a tree method.

Results with their own lifecycle, such as check runs or review checkpoints, may live beside the tree keyed by path rather than on nodes. Decide that when they arrive; their visible effect can still be emphasis and signals.
