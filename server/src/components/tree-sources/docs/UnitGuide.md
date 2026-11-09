# tree-sources Guide

Builds workspace trees from source observations. The working-changes source owns
fresh discovery, statistics materialization and bounded selected-file patches.

## Discovery and materialization

`index.ts` exposes the `working-changes` factory. `discover()` observes startup
repository participation, fresh path boundaries and finalized change membership.
Its opaque token keeps comparison descriptors and a canonical ownership tree
private. Bulk tracked numstat and exceptional comparisons needed for reconciliation
remain discovery work; whole-addition/deletion statistics are deferred.

`materialize()` acquires complete statistics into a new tree. `fileDiff()` acquires
only the selected final pair's missing statistics and patch. Both use the discovered
baseline and comparison context without mutating shared descriptors or storing
selected statistics on them. Discovered facts and collected changes have distinct
types; only complete trees become analysis inputs and authorize `currentByteSize`.

App ownership shares active discovery and clears it on settlement. Each request
owns its materialization/patch work independently. Bounded repository lanes cancel
and join peers before propagating failure. Omitting unrelated statistics also
excludes their failures from a selected-file operation; the
[protocol](../../../../docs/protocol.md) owns that failure scope and observable limits.

## Comparison and patch context

Final descriptors retain effective Git modes, a resolved baseline and explicit
source-index, scratch-index or whole-addition context. Recreated and boundary-clipped
pairs acquire statistics for their finalized sides. Owned scratch indexes compare
existing HEAD objects against working paths without clean-filtering baseline bytes
again or writing source Git metadata.

Patch acquisition reuses that context with applicable repository attributes, filters
and algorithm. Existing pairs seed a scratch index with a baseline blob; normalized
new-file pairs need only a constant empty blob. Ordinary pairs retain source-index
ancestor attributes when working attribute files are absent; reconciled pairs retain
their selected scratch-index policy. Whole additions use native no-index clean/EOL
semantics. No normalized current-text buffers or synthetic pair trees are materialized.

Rename content identity comes from nonzero raw blob identities. Similarity scores
and line counts cannot establish whether a move changed content. Boundary clipping
and recreated-source splitting discard rename-only facts when final entries become
additions or deletions.

File reads validate the current reconciled leaf before statistics and before/after
patch acquisition, using strict traversal and no-follow regular-file metadata.
An absent collected side stays absent despite an ignored physical recreation.
Short/all context uses one bounded acquisition path.

## Current-file size

`currentByteSize(tree, node, signal)` lazily observes metadata for collected current
regular files. It verifies complete-tree membership, startup repository identity and
current path boundaries, rejecting symlink ancestors/leaves and new undeclared
clones. Analysis owns reuse within its run; the source reads no content and caches
no observations. Missing or changed paths fail rather than becoming zero-byte files.
Historical-path discovery scope is deliberately more permissive than this physical
filesystem traversal.

## Source boundaries

Sources are nested units under `internal/`, exposed through the component surface.
They use `workspace-tree` vocabulary and its builder for canonical insertion, side
ownership and totals, and `workspace-repositories` for participation. Working-copy
comparison belongs here because it depends on workspace and nested-repository scope;
plain Git operations without workspace knowledge belong in `lib/git`.
