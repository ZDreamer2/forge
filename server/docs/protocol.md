# Workspace Server API

Contract for the server-owned workspace interface, independent of runtime support
or release status. Paths below are relative to `/api`; HTTP schemas are independent
of workspace-authoring types and renderer models.

## Shared contract

### HTTP access and failures

One server serves one workspace at `http://127.0.0.1:<port>`. Every request MUST have
Host exactly `127.0.0.1:<port>`; any Origin MUST equal that address. Absent Origin is
allowed. Foreign/`null` origins, aliases such as `localhost`, wrong ports and malformed
authorities are forbidden. Forwarded headers do not replace Host/Origin. Access
checks precede all routing/method handling, including HEAD, OPTIONS and unknown paths;
no permissive CORS headers are returned.

Failures use `{ "error": { "code": "...", "message": "..." } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Malformed file query, duplicate or unknown parameters. |
| 403 | `forbidden` | Failed authority/origin checks or excluded file participation. |
| 404 | `not_found` | Unknown operation. |
| 405 | `method_not_allowed` | Unsupported method on a known operation; `Allow` lists supported methods. |
| 500 | `internal_error` | Operation failure. |

Routing/middleware share this envelope. Messages omit stacks, environment values
and raw subprocess output. HEAD MAY perform GET without a response body; both are
read-only. Other methods, including OPTIONS, receive 405 on known paths and 404 on
unknown paths after access checks. Startup failures instead emit
terminal diagnostics and exit nonzero.

### Participation and comparison

File/change paths are workspace-relative POSIX paths inside the canonical workspace,
even when the main Git root extends above it. Absolute identity roots are descriptive,
not access authority. Only declared repositories participate: nested declarations
are distinct, missing-at-startup repositories stay excluded until restart, and loss
of an available repository fails collection. Git internals, gitlinks and undeclared
clones/contents are excluded; gitlink transitions expose only the ordinary side.

Changes compare HEAD with working content plus non-ignored untracked files:

- Git owns attributes, trusted filters, stat-cache/index flags and effective
  `core.fileMode`/`core.symlinks` semantics. Staged edits restored to HEAD disappear;
  assume-unchanged/skip-worktree edits may remain hidden.
- Same-path non-ignored recreations of staged deletions/rename sources are reconciled
  by normalized content/effective mode: identical restorations disappear, changed
  ones become modifications. A recreated rename source splits the rename into a
  destination addition and reconciled source. Ignored recreations absent from Git's
  untracked list remain deletions.
- Only Git-reported renames carry `from`; unstaged moves remain deletion/addition.
  Both rename sides are scoped: crossing moves become in-scope additions/deletions,
  without outside paths. Unborn HEAD uses an empty baseline; scoped unresolved
  conflicts fail collection even if the diff would be empty.
- Binary, mode/type and zero-line-count changes remain entries. UTF-8 filenames
  preserve tabs/newlines/spaces. Invalid filename encoding or failure of required
  Git/read/filter/normalization work returns `internal_error` without partial results.

This is practical Git comparison, not exhaustive physical/staging equivalence or
authority for broader dirt capture, checking or staging scopes.

### Ownership definitions

Changes, analysis and file responses include response-local `codebases` definitions:
`{ "<root-key>": { "id": "stable-guide-id", "root": "path", "guidance": "path" } }`.
All three fields are required. Definition-map keys and side owner references
are normalized workspace-relative source roots (`.` allowed). `id` is the stable
guide identifier, independent of checkout placement; it never substitutes for a
root key. Guidance is workspace-relative and may point outside the workspace
without authorizing file access. Only referenced rooted owners are included;
rootless guides create no synthetic owners. Definitions expose no ancestry graph
or legacy `type` field.

Ownership resolves lexically per present side: the closest containing registered
root wins; unmatched paths have no owner. Rename membership deduplicates base/current
owners in that order. All response object keys, including `__proto__`, are ordinary data.

### Observation, effects and lifecycle

Results are live observations without atomic cross-repository/request snapshots.
Overlapping GET/HEAD requests share active workspace-wide discovery, cleared on
settlement; later requests discover afresh. Disconnecting one client does not
cancel shared discovery. Discovery has finite command/output/total bounds.
Change listing, analysis and file requests each have an independent 30-second
budget including discovery wait. Each request owns its statistics acquisition and
subsequent source work, with independent cancellation and abort/drain on failure,
disconnect, timeout or shutdown. A file read does not wait for another request's
unrelated statistics.
Shutdown closes HTTP, stops admission, cancels/reaps owned Git/filter descendants
and removes temporary resources after settlement. Cooperative cancellation cannot
preempt synchronous trusted JavaScript.

Complete local Git repositories are supported; partial/promisor repositories are
refused before object-demanding work to prevent lazy fetch. Trusted filters/configuration
remain active; external diff/textconv, optional writes, fsmonitor and hooks are disabled.
Ambient Git root/index/worktree redirection is ignored. Server commands preserve
source/index/ref/object contents; native Git can freshen shared-index mtimes during
reads. YAML configuration is data-only. Trusted filters and analysis handlers execute
outside the read-only effects guarantee.

## Operations

### Workspace context

#### Read workspace context

`GET /workspace`

Returns the startup snapshot, replaced only on restart:

```json
{
  "workspace": { "root": "/absolute/canonical/checkout", "name": "Example workspace" },
  "repositories": [
    { "path": ".", "status": "available", "gitRoot": "/absolute/canonical/git-root" },
    { "path": "tools/optional-checkout", "status": "missing" }
  ]
}
```

`name` is authored nonempty YAML `display_name`, preserved exactly, otherwise the
canonical root's basename (or root itself). Clients MUST render it as literal text.
Repositories retain declaration order; `path` is `.` or a normalized workspace-relative
ID. Available repositories include canonical absolute `gitRoot` (possibly above the
workspace for `.`); missing ones omit it. Configuration internals/environment values
are not returned. Requests do not select workspaces or reload/discover participation.

### Workspace changes

#### List workspace changes

`GET /changes`

Returns `{codebases, changes: [...]}` under the shared comparison/ownership rules. Each
change has `repo`, `path`, `kind`, `codebases: string[]`, and rename-only `from`.

| Field | Meaning |
| --- | --- |
| `repo` | Declared repository ID from workspace identity. |
| `path` | Current path, or previous path for deletion. |
| `kind` | `added`, `modified`, `deleted`, `renamed`; type changes become modified, defensive copies become added. |
| `from` | Previous path, required only for renamed. |
| `codebases` | Unique present-side owner root keys; empty is valid. |

Empty success is `{ "codebases": {}, "changes": [] }`. Listing acquires complete
statistics before projection; acquisition failures return `internal_error` even
though the response omits counts. This light projection runs no handlers and omits
hierarchy, totals and review metadata; clients use the analyzed tree for structural
meaning.

#### Analyze workspace changes

`GET /changes/analysis`

Acquires complete statistics before analysis, then returns
`{root: ".", nodes, codebases, handlers}`. Every node, including hidden ones, has an
entry in the path-indexed `nodes` table. Each node carries:

| Fields | Shape/meaning |
| --- | --- |
| `path`, `children` | Canonical path and sorted child-path list. |
| `repo?`, `kind?`, `from?` | Change identity as above; directory ancestors need no own change. |
| `renameContentChanged?` | Rename content identity differs, based on source-observed blobs rather than similarity/line counts. |
| `statistics?` | Own `{added, removed, binary}` counts. |
| `base?`, `current?` | Present-side `{path, kind, repository?, codebase?, repositoryRoot?, codebaseRoot?}`; kind is `directory`, `file` or `symlink`. |
| `emphasis?` | Direct `{value, handler, reason?}` annotation. |
| `classification` | Node-local `{value, reason?, handler?}`; value is `code`, `tests`, `docs`, `config` or `assets`. |
| `effectiveEmphasis` | Inherited `{value, handler?, reason?, origin?}`; default is `{value: "normal"}`. |
| `signals` | Direct signals in handler order. |
| `signalCounts` | Inclusive `{notice, warning}` counts. |
| `rawTotals`, `attentionTotals` | Inclusive `{added, removed}` line totals. |

Side kinds/owners are independent through renames and file/directory transitions.
A rename occurs once at its destination; previous ancestors can remain with zero
counts. Side root fields label directory boundaries with the corresponding
repository ID or codebase root key. File/directory nodes count their own change and descendants.
`rawTotals` counts every nonbinary change exactly once; binaries contribute no
fabricated lines.
`attentionTotals` excludes effectively deemphasized/hidden entries.

Classification is required even on structural directories and root. Without an
explicit assignment it is `{value: "code"}`, with no handler or reason. Otherwise,
the last assignment supplies the value, handler ID and optional reason; explicit
`code` remains attributed. Classification never inherits or creates changed entries.
A renamed entry has one category at its destination; a deletion uses its old path.
Light change/file responses carry no classification.

Emphasis values are `normal`, `emphasized`, `deemphasized`, `hidden`. The last direct
setting wins on a node; the nearest explicit setting on the node or its ancestry
determines effective emphasis, including a normal reset. Explicit inheritance retains
reason, producing handler ID and origin path; default normal invents none.

Signals are `{severity: "notice" | "warning", message, handler, location?}`;
`location` is `{side: "base" | "current", line, column?}` with one-based coordinates.
Emphasis never suppresses signals or ancestor counts. `codebases` uses the shared
definitions; side `codebase`/`codebaseRoot` references are owner root keys.
`handlers` maps safe guide/hook IDs to `{id}`, for example
`codebase:forge-base#classifyNode` or `workspace#annotateNode`. It contains each
actually invoked identity once, in first-invocation order. Handler provenance has
no owner reference; adopting a parent creates no synthetic owner definition.

Classification completes across the whole tree before annotation starts, so
annotations can inspect every node's final category. Without adopted policies,
classification is `code`, emphasis is normal and signals are empty. The
[analysis contract](../src/components/tree-analysis/docs/UnitGuide.md) owns hook
capabilities, ordering and execution semantics.

Analysis annotations/state are independent per request even when collection overlaps.
Modules load at startup and refresh on restart. An applicable guide load error or hook invocation failure
returns HTTP 500 with `{ "error": { "code": "internal_error", "message": "Internal server error", "handler": "codebase:example#classifyNode" } }`.
Invocation failures identify the actual hook. Retained load errors identify the
first phase's `#classifyNode`, including when a broken export's hook set cannot be
determined. Unrelated broken participants do not block analysis. Contradictory owner
ordering returns `internal_error` without a handler field. Failures return no partial
analysis; raw causes/stacks/module paths stay private. Light `/changes` remains independently
available. Shared deadline/cancellation/effects rules apply.

#### Read file diff

`GET /changes/file?path=<canonical-change-path>[&context=3|all]`

Selects a change from fresh workspace-wide discovery without handlers. Statistics
and patch acquisition use only the selected finalized pair and the same resolved
comparison context. Unrelated statistics-only work is omitted and its failures
are outside this operation. All discovery, repository, reconciliation, membership
and ownership failures remain authoritative. Selected statistics/read/patch failures
return `internal_error` without partial success.

Default `context=3` returns three unchanged lines around hunks; `all` returns complete
represented context around changed payloads for expansion. Both retain the source's
final reconciled sides, applicable attributes, trusted filters and diff algorithm.
There is no separate full-file endpoint or renderer-specific model.

An unchanged/disappeared selection returns `{kind: "not_changed", codebases: {}}`.
Other results carry `path`, `repo`, `changeKind`, rename-only `from`, `statistics`,
`codebases`, `context` (`3` or `"all"`), `base`, `current` and resolved `baseline`
(`{kind: "commit", oid}` or `{kind: "unborn"}`). Statistics/definitions follow the
shared shapes. Each side is `{path, kind, mode, present, codebase?}` with effective
Git mode and `directory`/`file`/`symlink` kind. Absence is distinct from an empty file.

| `kind` | Additional result |
| --- | --- |
| `text` | Complete Git-style unified review `patch`, with quoted workspace-relative headers, change metadata and missing-newline markers. |
| `metadata_only` | No text hunks: e.g. empty additions/deletions, pure renames or mode-only changes. All context does not invent unchanged text. |
| `unsupported` | `reason`: `binary`, `encoding` or `too_large`; the latter includes `limitBytes`. No partial patch. |

HEAD blobs are never clean-filtered again. Whole additions also follow applicable
clean/EOL rules; raw disk-byte preservation is not promised. Represented CR/LF, BOM
and final-newline payload bytes survive. Symlinks expose target text, never referents,
including `core.symlinks=false` placeholders; current symlink ancestors are never
traversed. Directory transitions compare only file-like payloads, with directory
sides and separate descendants retained. Type transitions use byte-pair hunks/counts
and independent kind metadata, without guaranteeing executable `git apply` semantics.

#### Patch context and limits

- Decode queries once. Require one nonempty canonical workspace-relative POSIX
  `path`; only optional `context=3|all` is allowed. Unknown/duplicate parameters,
  absolute/platform escapes, NUL, empty/dot/dot-dot or `.git` segments are invalid.
  Literal spaces, tabs, newlines, `#`, `%`, `?` and Unicode survive. Supplied roots,
  refs or OIDs cannot authorize access.
- Limit final patches to 4 MiB before JSON escaping and raw current regular input
  to 8 MiB. Returned text is strict UTF-8 without NUL, respecting Git binary
  classification. Validation covers returned hunks/context, not all unshown bytes.
  Complete context can refuse for size/encoding/binary bytes while short context
  succeeds; clients retain the short diff and show expansion failure. Never truncate
  successful output. These bounds exclude native Git/filter allocations before stdout;
  application output/buffers, temporary resources and lifetime remain bounded.
- Fix the baseline once per operation. Context reloads are fresh observations, not
  pinned earlier working bytes; clients own freshness and reject incompatible
  initial/expanded results. A required side disappearing/changing kind or an
  available participant/Git/read/filter failure returns `internal_error`, not missing content.
  Unknown paths cannot authorize file reads. The 30-second request budget, independent
  cancellation, draining and read-only rules apply.

## Future capabilities

Directory listing, path-to-codebase context, review checkpoints/progress, agent
interaction and workspace actions remain future contracts. Directory listing is
intended to return immediate tracked/non-ignored children (workspace root default),
including required ancestor directories across participants and excluding Git internals;
links are identified without traversal. Display hiding/expansion/copying are client
concerns. Storage side effects for future merge-request sources remain unresolved.
