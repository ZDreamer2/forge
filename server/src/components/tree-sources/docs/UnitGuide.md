# tree-sources Guide

Builds base workspace trees from sources of workspace state. Each source produces a tree recording its two sides, plus a content reader for those sides that analysis and file/diff operations use.

## Notes

Not implemented yet. The HEAD/working comparison currently lives in `workspace-changes` and returns a flat change list.

Sources are nested units under `internal/`, exposed through this component's surface:

- `working-changes`: HEAD compared with the working copy across participating repositories, including non-ignored untracked files. The protocol owns its observable semantics.
- `project-files`: participating files of the project tree, listed by directory on demand rather than as a recursive tree.
- `merge-request`, later: one GitLab merge request.

A new source is a new nested unit, not a new architectural component.

Sources emit change entries in `workspace-tree` vocabulary and use its builder, so node insertion and owner resolution exist once. Entries carry per-file line counts, with binary files identified rather than counted; Git comparisons already report them. Directory and root totals are derived by the tree. Local sources use `workspace-repositories` participation rather than discovering repositories themselves.

Plain Git operations needing no workspace knowledge, such as comparing two commits or listing a tree at a commit, belong in `lib/git`. Comparison with the working copy stays here because it depends on participation and nested-repository boundaries.

Merge-request direction: GitLab knowledge stays inside that source. Its commits are fetched into a Forge-owned Git store, never into workspace repositories; the server then writes to its own storage, which the API contract's read-only question must address. Codebases are resolved with the current checkout's configuration, an approximation when the MR itself changes registration. Coordinated MRs across repositories would insert several comparisons into one tree.

Every tree is a live observation built per request, not an atomic cross-repository snapshot.
