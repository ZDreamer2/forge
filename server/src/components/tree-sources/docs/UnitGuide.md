# tree-sources Guide

Builds base workspace trees from sources of workspace state. Each source produces a tree recording its two sides. The working source also owns bounded per-change patch acquisition.

## Notes

`index.ts` exposes the `working-changes` source factory. It builds a canonical
workspace tree using startup repository participation and fresh path-boundary
observations for each collection. Effective Git modes and resolved baselines remain in private source descriptors;
the tree carries side kinds and statistics. Exceptional recreated or clipped pairs
receive statistics for their final sides. Owned scratch indexes compare existing HEAD objects against actual working
paths without normalizing baseline bytes again or writing source Git metadata.

Patch acquisition uses those descriptors and the applicable repository attributes,
filters and algorithm directly. Existing pairs seed an owned scratch index with
an existing baseline blob; normalized new-file pairs need only an owned constant
empty blob. Ordinary pairs retain applicable source-index ancestor attributes when
working attribute files are absent. Reconciled pairs retain their collector-selected
index policy. Raw, reconciled and collected facts have distinct types; only finalized
collected descriptors reach patch acquisition, with a mandatory resolved baseline
and explicit source-index, scratch-index or whole-addition context. Whole additions preserve the collector's no-index command semantics,
including clean/EOL attributes. No current normalized text buffers or synthetic
pair trees are materialized. Independent content readers and the other sources
below remain deferred.

Sources are nested units under `internal/`, exposed through this component's surface:

- `working-changes`: HEAD compared with the working copy across participating repositories, including non-ignored untracked files. The protocol owns its observable semantics.
- `project-files`: participating files of the project tree, listed by directory on demand rather than as a recursive tree.
- `merge-request`, later: one GitLab merge request.

A new source is a new nested unit, not a new architectural component.

Sources emit change entries in `workspace-tree` vocabulary and use its builder, so node insertion and owner resolution exist once. Entries carry per-file line counts, with binary files identified rather than counted; Git comparisons already report them. Directory and root totals are derived by the tree. Local sources use `workspace-repositories` participation rather than discovering repositories themselves.

Plain Git operations needing no workspace knowledge, such as comparing two commits or listing a tree at a commit, belong in `lib/git`. Comparison with the working copy stays here because it depends on participation and nested-repository boundaries.

Merge-request direction: GitLab knowledge stays inside that source. Its commits are fetched into a Forge-owned Git store, never into workspace repositories; the server then writes to its own storage, whose storage policy remains a future-source decision. Codebases are resolved with the current checkout's configuration, an approximation when the MR itself changes registration. Coordinated MRs across repositories would insert several comparisons into one tree.

Every tree is a live observation built per request, not an atomic cross-repository snapshot.

The working-changes source also supplies lazy `currentByteSize(tree, node, signal)`
for collected current regular files. It uses metadata, verifies tree membership,
startup repository identity and current path boundaries, and rejects symlink
ancestors/leaves and newly introduced nested clones. It neither reads file content
nor caches observations; analysis owns reuse within its run. Missing or changed
paths fail rather than becoming zero-byte files. Collection's historical-path
scope deliberately remains more permissive than this actual filesystem traversal.

Rename entries retain a content-change fact from the comparison's nonzero raw
blob identities. Similarity scores and binary/numeric line counts cannot establish
whether a move changed content. Boundary clipping and recreated-source splitting
discard rename-only facts when the final entries become additions or deletions.

File patch reads validate the current reconciled leaf before/after Git acquisition,
using strict traversal and no-follow regular-file metadata. An absent collected
side is not replaced by an ignored physical recreation. Short/all context shares
one acquisition path and finite output bounds; wire details belong to the protocol.
