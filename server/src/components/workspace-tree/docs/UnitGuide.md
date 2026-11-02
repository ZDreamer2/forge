---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# workspace-tree Guide

Vocabulary and data structure for a tree of workspace paths that sources build and analysis enriches. The same tree serves current changes, merge requests and the project tree, so review views share one model of nodes, ownership and metadata.

## Notes

`index.ts` exposes the request-local `WorkspaceTree`, its insertion vocabulary and `createWorkspaceTree`. Insertion resolves owners from explicit startup context. `nodes` includes real directory ancestors; `entries` retains source insertion order. `totals(path)` derives basic numeric added/removed line totals from current entry data. Analysis uses a separate run facade and final pass.

### Nodes

Node identity is the workspace-relative POSIX path; `.` is the root and stands for the whole workspace or changeset. Facts about the whole changeset attach to the root, facts about a codebase to its root directory.

Node kinds are `directory`, `file` and `symlink`. Repository and codebase roots are labels on directory nodes, not node kinds: one directory is often several at once, and the workspace root is typically all of them. There are no virtual grouping nodes; views such as grouping by codebase are projections of path nodes.

A tree records its two sides, such as HEAD and the working copy or two commits. A change on a node is `added`, `modified`, `deleted` or `renamed`. A rename is one node at the new path carrying its previous path and the source-owned `renameContentChanged` fact, never two linked nodes, so metadata and totals have exactly one place. A deleted node sits at its old path and exists only on the base side.

Owners (repository and codebase) are resolved here per side from registered roots by the closest-root rule; clients never resolve membership. A rename across codebases belongs to both sides' codebases.

### Metadata

The metadata set is fixed: classification (`code`, `tests`, `docs`, `config`, `assets`), emphasis (`emphasized`, `normal`, `deemphasized`, `hidden`, with reasons), signals (severity, message, source) and totals. Handlers express themselves through this set. A new kind is a deliberate change across this unit, `api-contract` and its consumers. Explicit metadata records which handler produced it.

Classification is node-local and never inherits. Every run starts each node, including structural directories and root, at `{value: "code"}`. Sequential assignments replace the value, optional reason and producing handler together; explicit Code remains attributed. The tree validates category values at runtime. Classification writes use a current-target capability supplied to the classifier; annotation nodes and their navigable relatives expose only readonly classification. Categorizing a structural node does not create a changed entry.

`deemphasize`, `restoreNormalEmphasis`, `emphasize` and `hide` set direct emphasis. The nearest explicit setting controls subtree inheritance, including a normal reset beneath hidden/deemphasized ancestry. `warn` and `notice` append direct signals with optional one-based side/line/column locations. Inclusive severity counts summarize them on ancestors and remain visible through de-emphasis.

After all handlers finish, `finalizeAnalysis` propagates effective emphasis from parent to child and aggregates raw/attention-filtered added and removed totals and inclusive signal counts bottom-up. Effective emphasis retains handler, reason and explicit origin; default normal has no invented handler. Handlers read direct annotations rather than stale derived values. Basic line totals cover every node including directories and the root. Renames count once along the destination path; former ancestry is retained for context with no duplicated file entry or counts. Binary entries contribute no fabricated text counts. Attention-filtered totals exclude effectively hidden/deemphasized entries. A file/directory transition contributes both its own statistics and its descendants.

### Shape

Light operations use the base tree without running analysis. `createAnalysisTree` builds one per-run facade/topology over its canonical source facts; it projects owner identity without executable handler descriptors. Each analysis node provides readonly parent/children navigation and synchronous preorder `walk()` including self. Root has no parent; rename topology uses the canonical destination path. Annotation methods attach the active handler identity without mutating the base.

A tree is built incrementally per request through `insert()`. Its live `nodes` and `entries` views allow reading, not independent structural edits: insertion owns node identity, side ownership and synchronization of the map and ordered entries. Statistics remain writable on base nodes. Analysis views expose readonly copies of statistics and sides, while each run owns separate classification and annotations; simultaneous analyses and light projections cannot share mutable metadata state. These are TypeScript API constraints, not a runtime sandbox for trusted code.

Classes are data-only under the service conventions: methods operate on their own fields, without dependencies or I/O. Source access is a capability supplied separately, not a tree method.

