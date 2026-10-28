# workspace-tree Guide

Vocabulary and data structure for a tree of workspace paths that sources build and analysis enriches. The same tree serves current changes, merge requests and the project tree, so review views share one model of nodes, ownership and metadata.

## Notes

`index.ts` exposes the request-local `WorkspaceTree`, its insertion vocabulary and `createWorkspaceTree`. Insertion resolves owners from explicit startup context. `nodes` includes real directory ancestors; `entries` retains source insertion order. `totals(path)` derives basic numeric added/removed line totals from current entry data. Analysis metadata and custom totals remain deferred.

### Nodes

Node identity is the workspace-relative POSIX path; `.` is the root and stands for the whole workspace or changeset. Facts about the whole changeset attach to the root, facts about a codebase to its root directory.

Node kinds are `directory`, `file` and `symlink`. Repository and codebase roots are labels on directory nodes, not node kinds: one directory is often several at once, and the workspace root is typically all of them. There are no virtual grouping nodes; views such as grouping by codebase are projections of path nodes.

A tree records its two sides, such as HEAD and the working copy or two commits. A change on a node is `added`, `modified`, `deleted` or `renamed`. A rename is one node at the new path carrying its previous path, never two linked nodes, so metadata and totals have exactly one place. A deleted node sits at its old path and exists only on the base side.

Owners (repository and codebase) are resolved here per side from registered roots by the closest-root rule; clients never resolve membership. A rename across codebases belongs to both sides' codebases.

### Metadata

The metadata set is fixed: emphasis (`emphasize`, `normal`, `deemphasize`, `hidden`, with reasons), signals (severity, message, source) and totals. Handlers express themselves through this set. A new kind is a deliberate change across this unit, `api-contract` and the UI, because each kind needs a wire shape and a rendering. Metadata records which handler produced it; it may later reference server-owned overview documents explaining it.

Emphasis applies to a subtree, and the nearest explicit setting wins, so an important subtree can contain unimportant ones such as tests deeper down. Signals bubble up to ancestors and are never hidden by de-emphasis: a warning inside a collapsed gray subtree stays visible on it.

Derived values are computed on demand from the tree rather than stored by pipeline phases, so future handlers can use them too. Basic line totals already cover every node including directories and the root. Renames count once along the destination path; former ancestry is retained for context with no duplicated file entry or counts. Binary entries contribute no fabricated text counts. Effective emphasis and further totals such as growth excluding de-emphasized files or per codebase follow with analysis.

### Shape

There is one tree type; analysis metadata is optional. Light operations such as listing, check scoping or staging use a tree without running analysis.

A tree is built incrementally per request through `insert()`. Its live `nodes` and `entries` views allow reading, not independent structural edits: insertion owns node identity, side ownership and synchronization of the map and ordered entries. Statistics remain writable on nodes, and analysis metadata will be enriched in place; the tree is not a frozen snapshot. These are TypeScript API constraints, not a runtime sandbox for trusted code.

Classes are data-only under the service conventions: methods operate on their own fields, without dependencies or I/O. Reading file content is a capability supplied separately, not a tree method.

Results with their own lifecycle, such as check runs or review checkpoints, may live beside the tree keyed by path rather than on nodes. Decide that when they arrive; their visible effect can still be emphasis and signals.
