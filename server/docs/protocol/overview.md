# Workspace Server API

Contract for the server-owned workspace interface, independent of runtime support
or release status. Paths are relative to `/api`; HTTP schemas are independent of
workspace-authoring types and renderer models. Detailed [change and file semantics](changes.md)
and [analysis semantics](analysis.md) live in companion contracts.

## Shared contract

### HTTP access and failures

One server serves one workspace at `http://127.0.0.1:<port>`. Every request MUST
have Host exactly `127.0.0.1:<port>`; any Origin MUST equal that address, though
Origin MAY be absent. Reject foreign/`null` origins, aliases such as `localhost`,
wrong ports and malformed authorities. Forwarded headers do not replace Host/Origin.
Apply access checks before routing/method handling, including HEAD, OPTIONS and
unknown paths; return no permissive CORS headers.

Failures use `{ "error": { "code": "...", "message": "..." } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid query, media type or request body. |
| 403 | `forbidden` | Failed authority/origin checks or excluded file participation. |
| 404 | `not_found` | Unknown operation. |
| 405 | `method_not_allowed` | Unsupported method on a known operation; `Allow` lists supported methods. |
| 500 | `internal_error` | Operation failure. |
| 503 | `internal_error` | Hosted hub registrations initially unavailable. |

Routing/middleware share this envelope. Messages omit stacks, environment values
and raw subprocess output. Inspection HEAD MAY perform GET without a response body;
both are read-only. After access checks, unsupported methods including OPTIONS
return 405 on known paths and 404 on unknown paths. Startup failures instead emit
terminal diagnostics and exit nonzero.

### Reload local configuration

`POST /configuration/reload` requires `Content-Type: application/json` (optional
charset allowed), no query parameters and an empty JSON object `{}` of at most
1024 bytes including whitespace. Invalid requests return 400 before reload. Every
other method returns 405 with `Allow: POST` after the shared access checks.

A completed reload returns 200 `{ok, concerns}` with keys `serverHubUrl`, `servers`
and `currentIssue`. Each concern contains:

- `status`: `accepted` or `rejected`.
- `source`: `{scope: "user" | "workspace", path: string, provenance: "file" | "default"}`
  identifying the attempted source; an absent source uses default provenance.
- `retainedPriorValue`: true only when rejection retained an earlier accepted value.
- `diagnostic`: bounded field-level explanation, present only on rejection.

`ok` is true only when every concern accepts. Rejection retains the prior accepted
value or leaves the concern unavailable; other valid concerns still apply. Accepted
deletion resets a concern to absence or an empty list. Responses expose no accepted
values, raw documents or unrelated workspace state. Unexpected failures use the
sanitized 500 envelope.

On an active hub host, reload applies the accepted registration list even when
another concern rejects. Concurrent reloads apply in order; responses do not wait
for availability probes. Rejected registrations retain the live list. Reload cannot
toggle hosting, edit configuration files, write current-issue selection or replace
workspace registries, guidance selection, extensions, repositories, ports or service
installation; those retain their startup/restart lifecycle.

### Inspect hosted server hub

On an explicitly activated host, `GET /server-hub/servers` and HEAD return the
current snapshot; other servers return 404. Queries return 400; other methods return
405 with `Allow: GET, HEAD`. Shared access rules apply, but server-to-server requests
omit Origin. Reads neither start nor wait for probes.

Success returns 200 `{servers: [...]}` in accepted registration order. Items contain
only `id`, `name`, `url` and `availability`:

- `status`: `unknown`, `reachable` or `unavailable`, from the last completed attempt.
- `checkedAt`: ISO timestamp of the last completed attempt, or null.
- `lastReachableAt`: ISO timestamp of the last successful identity probe, or null;
  retained on failure.
- `error`: sanitized diagnostic of at most 320 characters on failure, otherwise null.
- `stale`: true before any completed attempt or when `checkedAt` is over 90 seconds old.
  Initial unknown observations have null timestamps/error.

Availability probes GET `api/workspace` relative to the registered base URL.
Reachable requires a successful JSON workspace identity with string root/name and
a repositories array; this proves neither browser reachability nor agent readiness.
Discard remote identity payloads. Probes preserve base paths, follow no redirects,
send no application credentials, and have a three-second total deadline and 64-KiB
decoded-body limit.

Probes begin after listening and on target changes, with at most four in flight.
Ordinary rounds begin 30 seconds after the prior round settles. Name-only edits
preserve observations; URL changes reset them; removal cancels work. Superseded
results cannot replace current observations.

Missing/empty configuration yields an empty list. Initially invalid registrations
return 503 `{error: {code: "internal_error", message: "Server hub registrations are unavailable; repair configuration and reload"}}`.
Repair plus explicit reload recovers; review remains usable. Hosting and selecting
a hub URL are independent, without relaying or list aggregation.

## Operations

### Workspace context

#### Read workspace context

`GET /workspace` returns the startup snapshot, replaced only on restart:

```json
{
  "workspace": { "root": "/absolute/canonical/checkout", "name": "Example workspace" },
  "repositories": [
    { "path": ".", "status": "available", "gitRoot": "/absolute/canonical/git-root" },
    { "path": "tools/optional-checkout", "status": "missing" }
  ]
}
```

`name` is authored nonempty YAML `display_name` preserved exactly, otherwise the
canonical root's basename (or root itself). Clients MUST render it as literal text.
Repositories retain declaration order; `path` is `.` or a normalized
workspace-relative ID. Available repositories include canonical absolute `gitRoot`
(possibly above the workspace for `.`); missing ones omit it. Responses omit
configuration internals/environment values. Requests neither select workspaces nor
reload/discover participation.

### Workspace changes

All change operations use the shared [comparison, ownership and observation contract](changes.md).

#### List workspace changes

`GET /changes` returns `{codebases, changes: [...]}` under those shared rules. Each
change has:

| Field | Meaning |
| --- | --- |
| `repo` | Declared repository ID from workspace identity. |
| `path` | Current path, or previous path for deletion. |
| `kind` | `added`, `modified`, `deleted`, `renamed`; type changes become modified, defensive copies become added. |
| `from` | Previous path, required only for renamed. |
| `codebases` | Unique present-side owner root keys; empty is valid. |

Empty success is `{ "codebases": {}, "changes": [] }`. Listing acquires complete
statistics before projection; acquisition failures return `internal_error` although
counts are omitted. This projection runs no handlers and omits hierarchy, totals
and review metadata; use the analyzed tree for structural meaning.

#### Analyze workspace changes

`GET /changes/analysis` acquires complete statistics, then returns
`{root: ".", nodes, codebases, handlers, guidance}`. Path-indexed nodes expose
change identity, present sides, statistics, classification, emphasis, signals and
inclusive totals; top-level guidance is startup-resolved. Analysis returns no
partial result on failure; light `/changes` remains independently available.

The [analysis contract](analysis.md) owns response fields, guidance composition,
annotation behavior and failures.

#### Read file diff

`GET /changes/file?path=<canonical-change-path>[&context=3|all]` selects a change
from fresh discovery and returns reconciled sides, statistics, ownership, baseline
and a kind-specific patch result. Default `context=3` returns three unchanged lines
around hunks; `all` supplies complete represented context for expansion. An
unchanged/disappeared selection has kind `not_changed`; failures return no partial
success.

The [file-diff contract](changes.md#read-file-diff) owns query validation, response
fields, payload semantics and limits.

## Future capabilities

Directory listing, arbitrary path-to-codebase lookup, review checkpoints/progress,
agent interaction and workspace actions remain future contracts. Directory listing
is intended to return immediate tracked/non-ignored children (workspace root
default), including required ancestor directories across participants and excluding
Git internals; links are identified without traversal. Display
hiding/expansion/copying are client concerns. Storage side effects for future
merge-request sources remain unresolved.
