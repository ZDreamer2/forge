# Workspace changes and file diffs

Detailed contract for workspace change comparison, ownership, observation and file
diffs. Use with the [Workspace Server API](overview.md), which owns shared HTTP
access/failures and operation summaries. The endpoint path is relative to `/api`.

## Participation and comparison

File/change paths are workspace-relative POSIX paths inside the canonical workspace,
even when the main Git root extends above it. Absolute identity roots are descriptive,
not access authority. Only declared repositories participate: nested declarations
are distinct, missing-at-startup repositories remain excluded until restart, and
loss of an available repository fails collection. Exclude Git internals, gitlinks
and undeclared clones/contents; gitlink transitions expose only the ordinary side.

Changes compare HEAD with working content plus non-ignored untracked files:

- Git owns attributes, trusted filters, stat-cache/index flags and effective
  `core.fileMode`/`core.symlinks` semantics. Staged edits restored to HEAD disappear;
  assume-unchanged/skip-worktree edits may remain hidden.
- Reconcile same-path non-ignored recreations of staged deletions/rename sources by
  normalized content/effective mode: identical restorations disappear; changed ones
  become modifications. A recreated rename source splits into a destination addition
  and reconciled source. Ignored recreations absent from Git's untracked list remain
  deletions.
- Only Git-reported renames carry `from`; unstaged moves are deletion/addition. Scope
  both rename sides: crossing moves become in-scope additions/deletions without
  outside paths. Unborn HEAD uses an empty baseline. Scoped unresolved conflicts fail
  collection even with an empty diff.
- Binary, mode/type and zero-line-count changes remain entries. UTF-8 filenames
  preserve tabs/newlines/spaces. Invalid filename encoding or any required
  Git/read/filter/normalization failure returns `internal_error` without partial results.

This is practical Git comparison, not exhaustive physical/staging equivalence or
authority for broader dirt capture, checking or staging scopes.

## Ownership definitions

Changes, analysis and file responses include response-local `codebases`:
`{ "<root-key>": { "id": "stable-guide-id", "root": "path", "guidance": "path" } }`.
All fields are required. Map keys and side owner references are normalized
workspace-relative source roots (`.` allowed). `id` identifies the guide independently
of checkout placement and never substitutes for a root key. `guidance` is
workspace-relative and may point outside the workspace without granting file access.
Include only referenced rooted owners; rootless guides create no synthetic owners.
Definitions expose neither ancestry nor legacy `type`.

Ownership resolves lexically per present side: closest containing registered root
wins; unmatched paths have no owner. Rename membership deduplicates base/current
owners in that order. All response object keys, including `__proto__`, are ordinary data.

## Observation, effects and lifecycle

Results are live observations without atomic cross-repository/request snapshots.
Overlapping GET/HEAD requests share active workspace-wide discovery, cleared on
settlement; later requests rediscover. Disconnecting one client does not cancel
shared discovery. Discovery has finite command/output/total bounds.

Change listing, analysis and file requests each have an independent 30-second budget
including discovery wait. Each owns its statistics acquisition and subsequent source
work, with independent cancellation and abort/drain on failure, disconnect, timeout
or shutdown. File reads do not wait for another request's unrelated statistics.
Shutdown closes HTTP, stops admission, cancels/reaps owned Git/filter descendants
and removes temporary resources after settlement. Cooperative cancellation cannot
preempt synchronous trusted JavaScript.

Support complete local Git repositories; refuse partial/promisor repositories before
object-demanding work to prevent lazy fetch. Trusted filters/configuration remain
active; external diff/textconv, optional writes, fsmonitor and hooks are disabled.
Ignore ambient Git root/index/worktree redirection. Server commands preserve
source/index/ref/object contents, though native Git may freshen shared-index mtimes.
YAML configuration is data-only. Trusted filters and analysis handlers execute
outside the read-only effects guarantee.

## Read file diff

`GET /changes/file?path=<canonical-change-path>[&context=3|all]` selects a change
from fresh workspace-wide discovery without handlers. Statistics and patch
acquisition use only the selected finalized pair and resolved comparison context;
unrelated statistics-only work and its failures are excluded. Discovery, repository,
reconciliation, membership and ownership failures remain authoritative. Selected
statistics/read/patch failures return `internal_error` without partial success.

Default `context=3` returns three unchanged lines around hunks; `all` returns complete
represented context around changed payloads for expansion. Both retain final
reconciled sides, applicable attributes, trusted filters and diff algorithm. There
is no separate full-file endpoint or renderer-specific model.

An unchanged/disappeared selection returns `{kind: "not_changed", codebases: {}}`.
Other results carry `path`, `repo`, `changeKind`, rename-only `from`, `statistics`,
`codebases`, `context` (`3` or `"all"`), `base`, `current` and resolved `baseline`
(`{kind: "commit", oid}` or `{kind: "unborn"}`). Statistics/definitions use shared
shapes. Each side is `{path, kind, mode, present, codebase?}` with effective Git mode
and `directory`/`file`/`symlink` kind. Absence differs from an empty file.

| `kind` | Additional result |
| --- | --- |
| `text` | Complete Git-style unified review `patch`, with quoted workspace-relative headers, change metadata and missing-newline markers. |
| `metadata_only` | No text hunks: e.g. empty additions/deletions, pure renames or mode-only changes. All context does not invent unchanged text. |
| `unsupported` | `reason`: `binary`, `encoding` or `too_large`; the latter includes `limitBytes`. No partial patch. |

Never clean-filter HEAD blobs again. Whole additions follow applicable clean/EOL
rules; raw disk-byte preservation is not promised. Preserve represented CR/LF, BOM
and final-newline payload bytes. Symlinks expose target text, never referents,
including `core.symlinks=false` placeholders; never traverse current symlink
ancestors. Directory transitions compare only file-like payloads, retaining
directory sides and separate descendants. Type transitions use byte-pair
hunks/counts and independent kind metadata without guaranteeing executable
`git apply` semantics.

## Patch context and limits

- Decode queries once. Require one nonempty canonical workspace-relative POSIX
  `path`; only optional `context=3|all` is allowed. Reject unknown/duplicate
  parameters, absolute/platform escapes, NUL, empty/dot/dot-dot or `.git` segments.
  Preserve literal spaces, tabs, newlines, `#`, `%`, `?` and Unicode. Supplied roots,
  refs or OIDs cannot authorize access.
- Limit final patches to 4 MiB before JSON escaping and raw current regular input
  to 8 MiB. Return strict UTF-8 without NUL, respecting Git binary classification.
  Validate returned hunks/context, not all unshown bytes. Complete context may fail
  for size/encoding/binary bytes while short context succeeds; clients retain the
  short diff and show expansion failure. Never truncate successful output. Bounds
  exclude native Git/filter allocations before stdout; application output/buffers,
  temporary resources and lifetime remain bounded.
- Fix the baseline once per operation. Context reloads are fresh observations, not
  pinned working bytes; clients own freshness and reject incompatible
  initial/expanded results. A required side disappearing/changing kind or an
  available participant/Git/read/filter failure returns `internal_error`, not missing
  content. Unknown paths cannot authorize reads. Shared budget, cancellation,
  draining and read-only rules apply.
