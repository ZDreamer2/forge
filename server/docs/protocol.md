# Workspace Server API

API for accessing and operating on the workspace served by a Forge workspace server.

## Shared contract

- One server instance serves one workspace. Requests do not select a workspace.
- Operation paths below are relative to `/api`.
- Operation file/directory paths and change entries are workspace-relative and inside the workspace root, including when the main Git repository extends above it. Identity roots are descriptive absolute metadata; they do not authorize outside file access.
- HTTP schemas are independent of workspace-authoring types. This document specifies contracts, not which operations a particular build implements.

### HTTP access and failures

The configured address is `http://127.0.0.1:<port>`. Every request MUST have Host exactly `127.0.0.1:<port>`; every present Origin MUST equal that configured address. Absent Origin is allowed for CLI requests and navigation. Foreign or `null` origins, aliases such as `localhost`, wrong ports and malformed authorities are forbidden. Forwarded headers do not replace Host or Origin. Checks apply before routing, including GET, HEAD, OPTIONS and unknown paths. No permissive CORS headers are returned; OPTIONS does not bypass these checks.

API failures use JSON `{ "error": { "code": "...", "message": "..." } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 403 | `forbidden` | Request authority or origin failed access checks. |
| 404 | `not_found` | No operation matches the path. |
| 405 | `method_not_allowed` | A known operation does not support this method; `Allow` lists supported methods. |
| 500 | `internal_error` | The operation could not complete. |

Routing and middleware use the same envelope, including unknown API paths. Messages omit stacks, environment values and raw subprocess output. HEAD MAY follow GET with no response body; GET and HEAD remain read-only. Unsupported methods, including OPTIONS, receive 405 on known paths and 404 on unknown paths, after access checks. Startup failures produce terminal diagnostics and a nonzero exit, rather than an HTTP error.

## Operations

### Workspace context

#### Read workspace context

`GET /workspace`

Returns a startup snapshot:

```json
{
  "workspace": { "root": "/absolute/canonical/checkout", "name": "Example workspace" },
  "repositories": [
    { "path": ".", "status": "available", "gitRoot": "/absolute/canonical/git-root" },
    { "path": "tools/optional-checkout", "status": "missing" }
  ]
}
```

`workspace.root` is the canonical absolute selected checkout. `workspace.name` is its resolved display name: optional YAML `display_name` when authored, otherwise the canonical root's basename (or the root itself if it has no basename). An explicit name MUST be a nonempty string; it is preserved exactly. Clients MUST render names as literal text without HTML interpretation. Repositories retain configuration declaration order; `path` is the normalized declaration ID (`.` or a workspace-relative POSIX path). An available repository has canonical absolute `gitRoot`, which MAY be above the workspace for `.`; a missing repository omits it. Configuration internals and environment values are not returned. The snapshot is replaced on restart, with no per-request discovery or reload.

#### Resolve codebase context for paths

### Workspace changes

#### List workspace changes

`GET /changes`

Compares HEAD with working content across declared participating repositories,
plus non-ignored untracked files. Git owns attributes, trusted filters, stat-cache
and index-flag semantics. Staged edits restored to HEAD disappear. Same-path
non-ignored recreations of staged deletions/rename sources are reconciled by
normalized content and effective mode: identical restorations disappear; changed
ones are modified. A recreated rename source splits that rename into a destination
addition and a reconciled source. Ignored recreations absent from Git's untracked
list remain deletions; hidden assume-unchanged/skip-worktree edits may stay hidden.
This is practical Git comparison, not exhaustive physical or staging equivalence.
Unstaged moves remain deletion plus addition; only Git-reported renames carry a
source. Unborn HEAD uses an empty baseline; participating unresolved conflicts
fail the whole request even if a diff would be empty.

Returns a response-local definition index and changes:

```json
{
  "codebases": { "src/service": { "root": "src/service", "guidance": "docs/service", "type": "service" } },
  "changes": [
    { "repo": ".", "path": "src/file.ts", "kind": "modified", "codebases": ["src/service"] }
  ]
}
```

| Change field | Value |
| --- | --- |
| `repo` | Normalized declared repository ID, as in workspace identity. |
| `path` | Workspace-relative POSIX current path, or previous path for deletion. |
| `kind` | `added`, `modified`, `deleted` or `renamed`. Type changes normalize to modified; defensive copy records normalize to added. |
| `from` | Workspace-relative previous path, required only for renamed. |
| `codebases` | Unique normalized workspace-relative concrete roots; empty membership is valid. |

Top-level `codebases` maps each referenced concrete root to
`{ "root": "path", "guidance": "path", "type"?: "registered-type-id" }`.
The root is `.` or a workspace-relative POSIX path; guidance is relative to the
workspace and may point outside it. Types identify adopted shared guidance, not
concrete membership. Registry roots resolve lexically, independently for each
present side, with the closest containing root winning. An unmatched path has
empty membership. A rename includes both present-side owners, deduplicated in
base/current order. Definitions include only referenced owners; roots such as
`__proto__` remain ordinary data keys. Empty success is
`{ "codebases": {}, "changes": [] }`.

Binary changes and mode/type changes remain entries; Git's core.fileMode/core.symlinks semantics apply.
Gitlinks/undeclared clones and their contents are excluded; transitions between
ordinary files and gitlinks expose only the ordinary side. The light list omits binary classification and line counts; analysis exposes them. Declared nested repositories
remain distinct participants. Missing-at-startup declarations contribute no changes;
loss of an available repository fails collection until restart.

Both rename endpoints are scoped before publishing. A crossing move becomes an
in-scope addition/deletion, never an outside `from`. Membership includes applicable
in-scope sides and distinguishes codebase IDs from reusable guidance folders.
NUL-delimited UTF-8 filenames preserve tabs/newlines/spaces; invalid UTF-8 fails
explicitly. Git, read and normalization/filter failures
fail the whole request with `internal_error`, with no partial success.

Collections are live observations without atomic cross-repository snapshots.
Overlapping GET/HEAD share active collection, cleared on settlement; later requests
collect afresh. A client disconnect does not cancel other clients' shared work.
Collection has finite command/output/total bounds; shutdown cancels/reaps owned
Git/filter descendants and closes HTTP. App owns sharing/lifecycle, not a job system.

Support is complete local Git repositories; partial/promisor repositories are
refused before object-demanding comparison to prevent silent lazy fetch. Ordinary
trusted filters/configuration are allowed. External diff/textconv, optional writes,
fsmonitor and hooks are disabled, and ambient Git root/index/worktree redirection
is removed. Server commands do not stage/commit/write source indexes, refs or
objects. YAML configuration is data-only; trusted filters and analysis handlers execute code outside this effects guarantee.

This browser list does not replace Python dirt detection, capture or checking/
staging. Future migration must align collection/check/staging participation together;
never stage the broader discovered/whole-repository scope using only this narrow list.

This list carries no tree structure, totals or review metadata. Clients do not
reconstruct structural meaning from it; the server-owned changes tree is the subject
of the analysis operation below.

#### Analyze workspace changes

`GET /changes/analysis`

Returns a fresh analyzed workspace changes tree. Collection uses the same participation,
comparison and read-only guarantees as `/changes`. The response is:

```json
{
  "root": ".",
  "nodes": {
    ".": {
      "path": ".", "children": [],
      "base": { "path": ".", "kind": "directory", "repository": ".", "repositoryRoot": "." },
      "current": { "path": ".", "kind": "directory", "repository": ".", "repositoryRoot": "." },
      "signals": [], "effectiveEmphasis": { "value": "normal" },
      "signalCounts": { "notice": 0, "warning": 0 },
      "rawTotals": { "added": 0, "removed": 0 },
      "attentionTotals": { "added": 0, "removed": 0 }
    }
  },
  "codebases": {},
  "handlers": {
    "builtin:deemphasize-directories": { "id": "builtin:deemphasize-directories" },
    "builtin:large-markdown": { "id": "builtin:large-markdown" }
  }
}
```

Every child path has its own node. `nodes` is indexed by canonical workspace-relative path, including
`.`. Nodes carry `path`, sorted `children` path lists and optional `repo`, change
`kind`, rename `from`, `renameContentChanged`, and own `statistics`:
`{added, removed, binary}`. Each present `base`/`current` side carries its own
`path` and `kind` (`directory`, `file`, `symlink`), optional `repository` and
`codebase` identity, and optional `repositoryRoot`/`codebaseRoot` labels. Side
kinds can differ during file/directory transitions. Rename nodes occur once at
the destination, retaining previous-side ownership; former ancestors may remain
with zero counts. Rename content change compares source-observed blob identities,
independently of Git similarity or line counts.

`rawTotals` includes a node's own nonbinary statistics and descendants exactly
once. `attentionTotals` excludes entries whose effective emphasis is `deemphasized`
or `hidden`. Binary entries contribute no fabricated lines. `emphasis`, when set,
is the node's direct `{value, reason, handler}` annotation. The last direct setting
wins on that node; the nearest explicit setting along canonical ancestry wins for
`effectiveEmphasis`, including a `normal` reset. Effective explicit values retain
`reason`, producing `handler` and `origin` path; default normal has no invented
handler. Values are `normal`, `emphasized`, `deemphasized`, `hidden`.

`signals` contains direct `{severity, message, handler, location?}` payloads in
handler order. Severity is `notice` or `warning`; an optional authored location is
`{side: "base" | "current", line, column?}` with one-based coordinates.
`signalCounts` includes direct and descendant counts by severity. Emphasis never
suppresses signals or ancestor counts. All nodes, including hidden ones, remain
in the response. Object keys such as `__proto__` are ordinary data keys.

`codebases` defines referenced owners as in `/changes`. `handlers` maps each safe
configured occurrence ID to `{id, codebase?}`; a codebase handler's owner may have
no changed files. IDs distinguish repeated module references without exposing
absolute module filenames. Definitions are descriptive, not additional tree nodes.

Built-ins run first, then workspace handlers in list order and concrete handlers
in registry/list order. Each trusted handler sees the whole tree and may annotate
any node. Built-ins deemphasize root `plans/` and directories named exactly `tests`
or `Tests`. They warn on current regular Markdown (`.md`/`.markdown`, case
insensitive) larger than 20,480 bytes for additions, modifications and content-edited
renames. Pure moves, deletions, symlinks and current root `plans/` paths are excluded.
Size lookup uses current metadata, does not read file bytes or follow symlinks,
and fails if a candidate is no longer an eligible current file within source bounds.

Analysis state is independent per request even when base collection overlaps.
The total 30-second operation budget includes collection waiting. Disconnect,
timeout and shutdown cancel only the affected run; shared collection belongs to
the application. Failed/cancelled analysis aborts and drains its owned source
observations before disposal completes. Cancellation is cooperative and cannot preempt synchronous trusted
JavaScript. Modules load at startup and refresh on process restart. Handler load or
invocation failure fails the whole analysis with HTTP 500 and
`{ "error": { "code": "internal_error", "message": "Internal server error", "handler": "safe-occurrence-id" } }`.
Raw causes, stacks and module paths are omitted. Light `/changes` executes no
handlers and remains independently available. Forge inspection does not write
workspace/Git state; trusted executable modules are outside an effects sandbox.

#### Read file diff

Future operation: takes a changed file's workspace-relative path and returns a per-file Git-style unified patch and separate change metadata. The baseline and staging reconciliation remain to be defined independently of this practical Git change list. The patch includes file headers, all text changes, and limited unchanged context, preserving missing-final-newline markers.

Added files compare against an empty baseline; deleted files compare against empty current content. Renames identify both paths and compare the previous HEAD content with the current content. Binary changes are identified explicitly rather than returned as text hunks. Metadata-only changes, such as pure renames or file-mode changes, remain identifiable even when there are no text hunks.

Clients load complete old/new text through `Read file content` when expanding omitted context or switching to full-file viewing. Patch parsing and renderer-specific models belong to the client, not the wire contract.

Oversized text diffs produce an explicit unsupported-content result rather than a silently truncated patch. The size limit remains to be selected during implementation.

### Workspace files

#### Read file content

Takes a workspace-relative path and selects either current working-copy content or HEAD content from the containing participating repository. Returns the whole text file for full-file viewing, including unchanged files.

For a rename's HEAD content, callers use the previous path. A file absent from the selected version is reported as missing, including added files at HEAD and deleted files in the working copy. Missing content is distinct from an existing empty file; clients use an absent side when constructing an added/deleted file comparison.

Text preserves line endings and whether the final line ends with a newline. Read failures are reported as failures rather than empty or missing content. Binary, unsupported-encoding, and oversized files produce an explicit unsupported-content result with the reason. The size limit remains to be selected during implementation.

#### List directory entries

Takes a workspace-relative directory path, with the workspace root as the default, and returns its immediate children with names and entry kinds. Directories are expanded on demand rather than returned as a recursive workspace tree.

Includes tracked and non-ignored working-copy files and the directories needed to reach them, across participating repositories. Git internals are excluded. Symbolic links are identified as links rather than traversed.

Additional directory hiding, tree expansion state, and copying paths are client concerns.

## Future capabilities

### Review checkpoints and progress

### Agent interaction

### Workspace actions

## Open decisions

- Storage side effects for future merge-request sources remain to be defined.
