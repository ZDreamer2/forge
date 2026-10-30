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
  preserve tabs/newlines/spaces; invalid filename encoding, Git/read/filter or
  normalization failures return `internal_error` without partial results.

This is practical Git comparison, not exhaustive physical/staging equivalence or
authority for broader dirt capture, checking or staging scopes.

### Ownership definitions

Changes responses include response-local `codebases`:
`{ "<id>": { "root": "path", "guidance": "path", "type"?: "registered-type-id" } }`.
IDs/roots are normalized concrete workspace-relative roots (`.` allowed), not reusable
guidance/type IDs. Guidance is workspace-relative and may point outside it without
authorizing file access. Only referenced definitions are included.

Ownership resolves lexically per present side: the closest containing registered
root wins; unmatched paths have no owner. Rename membership deduplicates base/current
owners in that order. All response object keys, including `__proto__`, are ordinary data.

### Observation, effects and lifecycle

Results are live observations without atomic cross-repository/request snapshots.
Overlapping GET/HEAD requests share active base collection, cleared on settlement;
later requests collect afresh. Disconnecting one client does not cancel shared work.
Collection has finite command/output/total bounds. Analysis and file requests each
have a 30-second total budget including collection wait, independent cancellation,
and abort/drain of owned source work on failure, disconnect, timeout or shutdown.
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
| `codebases` | Unique present-side concrete owner IDs; empty is valid. |

Empty success is `{ "codebases": {}, "changes": [] }`. This light projection runs
no handlers and omits statistics, hierarchy, totals and review metadata; clients use
the analyzed tree for structural meaning.

#### Analyze workspace changes

`GET /changes/analysis`

Returns `{root: ".", nodes, codebases, handlers}`. Every node, including hidden ones,
has an entry in the path-indexed `nodes` table. Each node carries:

| Fields | Shape/meaning |
| --- | --- |
| `path`, `children` | Canonical path and sorted child-path list. |
| `repo?`, `kind?`, `from?` | Change identity as above; directory ancestors need no own change. |
| `renameContentChanged?` | Rename content identity differs, based on source-observed blobs rather than similarity/line counts. |
| `statistics?` | Own `{added, removed, binary}` counts. |
| `base?`, `current?` | Present-side `{path, kind, repository?, codebase?, repositoryRoot?, codebaseRoot?}`; kind is `directory`, `file` or `symlink`. |
| `emphasis?` | Direct `{value, handler, reason?}` annotation. |
| `effectiveEmphasis` | Inherited `{value, handler?, reason?, origin?}`; default is `{value: "normal"}`. |
| `signals` | Direct signals in handler order. |
| `signalCounts` | Inclusive `{notice, warning}` counts. |
| `rawTotals`, `attentionTotals` | Inclusive `{added, removed}` line totals. |

Side kinds/owners are independent through renames and file/directory transitions.
A rename occurs once at its destination; previous ancestors can remain with zero
counts. Side root fields label directory boundaries with the corresponding
repository/codebase ID. File/directory nodes count their own change and descendants.
`rawTotals` counts every nonbinary change exactly once; binaries contribute no
fabricated lines.
`attentionTotals` excludes effectively deemphasized/hidden entries.

Emphasis values are `normal`, `emphasized`, `deemphasized`, `hidden`. The last direct
setting wins on a node; the nearest explicit setting on the node or its ancestry
determines effective emphasis, including a normal reset. Explicit inheritance retains
reason, producing handler ID and origin path; default normal invents none.

Signals are `{severity: "notice" | "warning", message, handler, location?}`;
`location` is `{side: "base" | "current", line, column?}` with one-based coordinates.
Emphasis never suppresses signals or ancestor counts. `codebases` uses the shared
definitions; `handlers` maps safe occurrence IDs to `{id, codebase?}`, distinguishing
repeated module references without exposing absolute module paths. Referenced handler
owners can have no changed files; definitions do not create tree nodes.

Built-ins run first, then workspace handlers in list order and concrete handlers in
registry/list order. All trusted handlers see the whole tree and can annotate any
node. Built-ins:

- Deemphasize root `plans/` and directories named exactly `tests` or `Tests`.
- Warn on current regular Markdown (`.md`/`.markdown`, case-insensitive) larger than
  20,480 bytes for additions, modifications and content-edited renames, except root
  `plans/`. Metadata-only size probes read no bytes or symlinks and fail if the
  candidate disappears, changes kind or leaves source bounds.

Analysis annotations/state are independent per request even when collection overlaps.
Modules load at startup and refresh on restart. Handler load/invocation failure
returns HTTP 500 with `{ "error": { "code": "internal_error", "message": "Internal server error", "handler": "safe-occurrence-id" } }`;
raw causes/stacks/module paths stay private. Light `/changes` remains independently
available. Shared deadline/cancellation/effects rules apply.

#### Read file diff

`GET /changes/file?path=<canonical-change-path>[&context=3|all]`

Selects a freshly collected change without handlers. Default `context=3` returns
three unchanged lines around hunks; `all` returns complete represented context around
changed payloads for expansion. Both retain the collector's final reconciled sides,
applicable attributes, trusted filters and diff algorithm. There is no separate
full-file endpoint or renderer-specific model.

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
  pinned earlier working bytes; clients own refresh generations and reject incompatible
  initial/expanded results. A required side disappearing/changing kind or an available
  participant/Git/read/filter failure returns `internal_error`, not missing content.
  Unknown paths cannot authorize file reads. The shared 30-second budget, independent
  cancellation, draining and read-only rules apply.

## Future capabilities

Directory listing, path-to-codebase context, review checkpoints/progress, agent
interaction and workspace actions remain future contracts. Directory listing is
intended to return immediate tracked/non-ignored children (workspace root default),
including required ancestor directories across participants and excluding Git internals;
links are identified without traversal. Display hiding/expansion/copying are client
concerns. Storage side effects for future merge-request sources remain unresolved.
