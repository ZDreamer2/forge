# Workspace change analysis

Detailed contract for `GET /changes/analysis`. Use with the [Workspace Server API](overview.md)
and [shared change rules](changes.md), which own HTTP access/failures, comparison,
owner definitions and observation/effects. The endpoint path is relative to `/api`.

## Analyze workspace changes

`GET /changes/analysis` acquires complete statistics, then returns
`{root: ".", nodes, codebases, handlers, guidance}`. Every node, including hidden
ones, has an entry in the path-indexed `nodes` table:

| Fields | Shape/meaning |
| --- | --- |
| `path`, `children` | Canonical path and sorted child-path list. |
| `repo?`, `kind?`, `from?` | Change identity as defined by [change listing](overview.md#list-workspace-changes); directory ancestors need no own change. |
| `renameContentChanged?` | Rename content identity differs, based on source-observed blobs rather than similarity/line counts. |
| `statistics?` | Own `{added, removed, binary}` counts. |
| `base?`, `current?` | Present-side `{path, kind, repository?, codebase?, repositoryRoot?, codebaseRoot?}`; kind is `directory`, `file` or `symlink`. |
| `emphasis?` | Direct `{value, handler, reason?}` annotation. |
| `classification` | Node-local `{value, reason?, handler?}`; value is `code`, `tests`, `docs`, `config` or `assets`. |
| `effectiveEmphasis` | Inherited `{value, handler?, reason?, origin?}`; default is `{value: "normal"}`. |
| `signals` | Direct signals in handler order. |
| `signalCounts` | Inclusive `{notice, warning}` counts. |
| `rawTotals`, `attentionTotals` | Inclusive `{added, removed}` line totals. |

## Guidance composition

Required `guidance` is the authoritative startup-resolved composition:

```ts
type GuidanceEntry = {
  id: string; // codebase:<configured ID>, or workspace
  name: string; // configured ID, or workspace display name
  root?: string; // workspace-relative source root; workspace is dot; absent for rootless guides
  guidance: string; // guide directory: workspace-relative inside, absolute outside
  source: 'workspace-parent' | 'workspace' | 'project-parent' | 'project-folder';
};
type WorkspaceGuidance = {
  workspace: GuidanceEntry[];
  codebases: Record<string, GuidanceEntry[]>;
};
```

`workspace` is the unowned-subject chain; `codebases` maps every available owner
root (`.` allowed), even without changes, to its workspace/owner composition.
Chains follow explicit inheritance in application order, with shared guides once.
Clients MUST preserve order, using independent chains when side owners differ.
Source labels are `workspace` for the workspace, `project-folder` for the selected owner,
`workspace-parent` for other workspace ancestry including shared guides, and
`project-parent` otherwise. Guide paths are data, not access authority; external
directories are absolute, unlike [owner definitions](changes.md#ownership-definitions).
This snapshot changes on restart, not Refresh, and describes composition rather
than which `handlers` ran.

## Side identity and totals

Side kinds/owners are independent through renames and file/directory transitions.
A rename occurs once at its destination; previous ancestors can remain with zero
counts. Side root fields label directory boundaries with repository ID or codebase
root key. Nodes count their own change and descendants. `rawTotals` counts every
nonbinary change exactly once; binaries contribute no fabricated lines.
`attentionTotals` excludes effectively deemphasized/hidden entries.

## Classification and emphasis

Classification is required even on structural directories and root. Without explicit
assignment it is `{value: "code"}` with no handler/reason. Otherwise, the last
assignment supplies value, handler ID and optional reason; explicit `code` remains
attributed. Classification neither inherits nor creates changed entries. Renames
have one category at their destination; deletions use old paths. Light change/file
responses carry no classification.

Emphasis values are `normal`, `emphasized`, `deemphasized`, `hidden`. The last direct
setting wins; the nearest explicit node/ancestor setting determines effective
emphasis, including a normal reset. Explicit inheritance retains reason and produces
handler ID/origin path; default normal invents none.

## Signals and handlers

Signals are `{severity: "notice" | "warning", message, handler, location?}`;
`location` is `{side: "base" | "current", line, column?}` with one-based coordinates.
Emphasis suppresses neither signals nor ancestor counts. `codebases` uses shared
[owner definitions](changes.md#ownership-definitions); side
`codebase`/`codebaseRoot` references are owner root keys.

`handlers` maps safe guide/hook IDs to `{id}`, such as
`codebase:forge-base#classifyNode` or `workspace#annotateNode`, containing each
invoked identity once in first-invocation order. Handler provenance has no owner
reference; adopting a parent creates no synthetic owner definition.

Classification completes across the tree before annotation, so annotations see final
categories. Without adopted policies, classification is `code`, emphasis normal and
signals empty. The [analysis implementation contract](../../src/components/tree-analysis/docs/UnitGuide.md)
owns hook capabilities, ordering and execution semantics.

## Request state and failures

Annotations/state are request-local even when collection overlaps. Modules load at
startup and refresh on restart. Applicable guide load or hook failure returns HTTP 500
`{ "error": { "code": "internal_error", "message": "Internal server error", "handler": "codebase:example#classifyNode" } }`.
The handler identifies the actual failed hook. Retained load errors identify the
first phase's `#classifyNode`, even when a broken export's hook set is indeterminate.
Unrelated broken participants do not block analysis. Contradictory owner ordering
returns `internal_error` without `handler`. Failures return no partial analysis and
hide raw causes/stacks/module paths. Light `/changes` remains independently available.
Shared [deadline, cancellation and effects rules](changes.md#observation-effects-and-lifecycle)
apply.
