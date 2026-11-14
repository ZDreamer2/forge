---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Server hub guide

The hub owns centrally collected availability observations for accepted explicit
registrations. The app supplies the configuration component's typed list, or
`null` when the registrations concern has never accepted a value. An unavailable
concern differs from a valid empty list. The hub reads no files, mounts no routes
and performs no workspace operations. Configuration remains the structural
validation owner; HTTP mapping remains in `http-api`.

The app constructs a hub only for the explicit host role and starts it after the
listener accepts requests, so explicit self-registration works. A configuration
reload replaces registrations synchronously and then drains superseded work; it
does not await the replacement probes. App serialization must cover both storage
reload and this application step. The app closes the hub on shutdown and startup
failure. Close is idempotent, aborts requests, clears scheduling and waits for
owned work to settle.

## Meaning of an observation

Availability means that a GET from this hub to `api/workspace`, resolved against
the configured base URL, completed with a valid minimal Forge workspace identity.
It does not establish browser reachability, configured target identity or agent
readiness. Navigation and probing use the same configured address; there is no
loopback rewriting or address discovery. Existing exact loopback Host guards may
legitimately reject other configured authorities.

Probes omit Origin and application credentials, refuse redirects and require JSON
with string workspace root/name fields and a repositories array. Remote roots,
repository payloads and response diagnostics are discarded. One three-second
deadline covers headers and body; the streamed decoded body is limited to 64 KiB.
Failures cancel body consumption and expose only bounded fixed diagnostics.

An observation starts unknown and stale. A completed attempt records its time;
success records the last reachable time and clears errors, while failure preserves
the previous last reachable time. Staleness begins only when the latest completed
attempt is older than 90 seconds. Inspection returns an immutable current snapshot
and never triggers or waits for probes. The [HTTP contract](../../../../docs/protocol/overview.md)
owns its wire shape and unavailable-configuration response.

## Reconciliation and scheduling

IDs and URLs determine target continuity. Name changes and list reordering retain
observations and active work. A changed URL resets that entry to unknown; removed
entries disappear immediately. Target changes abort the current round and drain
it before probing the latest list, coalescing repeated replacements. Publication
also checks entry identity and cancellation, so late responses cannot restore an
old target or publish after shutdown.

One round uses at most four workers. Its next refresh starts 30 seconds after the
whole round settles. There is at most one round and one scheduled next refresh;
empty or unavailable lists need neither. Unexpected operational failures preserve
prior observations, report a sanitized diagnostic and allow freshness to age.
Fetch, time and timer capabilities can be injected for deterministic owner tests;
there is no subscription, persistence or generic scheduler framework.
