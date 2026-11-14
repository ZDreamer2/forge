---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Configuration guide

`createConfiguration` owns accepted local values for three independent concerns.
The app supplies the canonical workspace root, resolved personal configuration
directory and selected guidance directory. This component reads no environment,
interprets no authored workspace registry and imports no other component.

## Sources and accepted values

| Concern | Scope and source | Missing value |
| --- | --- | --- |
| `serverHubUrl` | User `config.yaml` | No URL |
| `servers` | User `server-hub.yaml` | Empty ordered list |
| `currentIssue` | Workspace `<guidance>/.local/state.json` | No selection |

YAML is strict data: unknown fields, duplicate keys, explicit null settings and
invalid shapes reject their concern. URLs are HTTP(S) base URLs, normalized with
a trailing slash while preserving base paths. Registration IDs are unique ASCII
slugs; duplicate URLs are allowed. Registration use and remote availability belong
to consumers, outside structural validation.

Initialization and explicit reload use the same validators. A present invalid or
unreadable initial source leaves its concern unavailable with a bounded field-level
diagnostic. Rejection after acceptance retains the prior value and its original
source metadata. Reload results describe the attempted source and whether a prior
value was retained. Other concerns accept independently; `ok` requires all three.
Successful deletion accepts the missing value with default provenance.

Typed reads are immutable accepted snapshots. File edits become visible only after
reload, or a successful programmatic current-issue write. Reloads and writes are
serialized within one owner so older work cannot overwrite newer accepted values.
`app` wires reload directly to its consumers and the protected HTTP callback;
the component has no subscriptions or listener/service lifecycle responsibility.

## Shared current-issue storage

State is a JSON object. `current_issue`, when present, is an object containing a
nonblank string `directory`; additional top-level data is preserved literally.
The server retains JSON numeric tokens during rewriting so unrelated Python
integers and precise decimals survive without JavaScript number conversion.
Reads resolve relative directories against the canonical workspace root. Stored
selections may be stale; storage does not inspect IssueSpec or issue semantics.
Writes replace the entire `current_issue` object with `{directory}`, using a
workspace-relative POSIX directory where possible and an absolute path otherwise.

Python `workspace_state.py` and server writers share this private protocol:

1. Create the selected guidance folder's `.local` directory as needed and maintain
   its `.gitignore` containing `*`.
2. Exclusively create `.local/state.json.lock` with `mkdir`. Retry contention at
   a short fixed interval for at most two seconds. Never reclaim another lock.
3. Reread and validate state after acquiring the lock, then preserve unrelated
   fields and atomically rename a same-directory temporary file over `state.json`.
4. Clean temporary files and release the acquired lock in `finally`. Publish the
   accepted selection only after successful replacement.

Ordinary reads/reload remain unlocked and create nothing; atomic replacement lets
them see a complete document. Serialization protects one owner's accepted state;
the shared lock prevents cross-process lost updates. A crash may leave a lock:
the timeout diagnostic identifies its path and requires confirming no writer
remains before manual cleanup. There is no automatic stale-lock recovery.

The [HTTP contract](../../../../docs/protocol.md#reload-local-configuration) owns
wire validation and privacy. The [README](../../../../../README.md#local-configuration-and-reload)
owns file examples, operating commands and recovery instructions.
