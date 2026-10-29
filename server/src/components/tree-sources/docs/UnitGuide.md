# tree-sources Guide

Builds base workspace trees from sources of workspace state. Each source produces a tree recording its two sides. Content readers for analysis and file/diff operations will accompany sources when those capabilities arrive.

## Notes

`index.ts` exposes the `working-changes` source factory. It builds a canonical
workspace tree using startup repository participation and fresh path-boundary
observations for each collection. Raw Git modes and numstat counts survive into
the tree; exceptional recreated or clipped pairs receive statistics for their final
sides. Owned scratch indexes compare existing HEAD objects against actual working
paths without normalizing baseline bytes again or writing source Git metadata.

Full content readers and the other sources below are deferred until they have consumers;
current analysis needs only metadata byte sizes alongside the base tree.

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
