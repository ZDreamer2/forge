---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# workspace-config Guide

Interprets trusted authored workspace configuration into the available guide
registry, rooted participants, declared repositories, display name and direct
analysis-handler references. Loading and chain resolution execute no project code.

`index.ts` exposes loading, rooted registry vocabulary and guide-chain resolution.
The source is `forge-workspace.yaml` in the folder selected by
`ZD_AI_FORGE_WORKSPACE_GUIDE` (default `docs/forge/workspace`), and its registered
`forge-codebase.yaml` markers. Required stable IDs identify guides; optional roots
establish ownership independently of ordered parent ancestry. Rootless guides can
contribute ancestry but never become source owners. A rooted guide remains an
ordinary participant when reused as a parent.

The required server `repositories` list contains normalized workspace-relative
paths (`.` allowed); optional `display_name` is preserved literally. Repositories
are declared, never discovered. Whether they exist, their Git roots and current
state belong to `workspace-repositories`. Python retains its repository scan.

Keep registry and chain semantics equivalent to Python's
`ai/bc-plugins/dev/forge/scripts/workspace_codebases/_registry.py` and `_chains.py`.
The [guide-chain contract](../../../../../../../../ai/bc-plugins/dev/forge/docs/theory/codebases/guide-chain-resolution.md)
owns independent ancestry construction and topological merging. Missing markers
or source roots leave unavailable registrations; a required unavailable parent
fails resolution. Present malformed declarations fail before missing-root exclusion.
Available IDs/roots and canonical registration references are unique. Legacy type
configuration fails with actionable migration diagnostics.

Application startup validates the workspace chain and each available rooted
participant's composed chain before loading executable handlers or opening the
listener, even without current changes. Unrelated rootless ancestry remains
unresolved. Python resolves selected chains per operation; the server's startup
validation is deliberately broader. Restart replaces this configuration snapshot.

`workspace-tree` resolves per-side ownership by the closest lexical registered root,
including deleted paths. This unit supplies rooted participants rather than
per-change callbacks. Neither inheritance nor installation boundaries change roots.

Optional direct YAML `analysis_handlers` lists preserve workspace then rooted
registry/list order and repeated references. Descriptors retain absolute
YAML-relative module paths and one-based ordinals; missing modules remain explicit
references. Parent adoption and rootless registrations add no handler executions.
Configuration loading never imports modules. `tree-analysis` loads them at startup
and retains load failures for analysis requests. The
[analysis guide](../../tree-analysis/docs/UnitGuide.md) owns supported ESM syntax,
public authoring and whole-tree annotation scope.

This vocabulary is not a wire contract. `http-api` owns public definition projection.
