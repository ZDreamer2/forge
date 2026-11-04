---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge UI architecture

The standalone React application owns browser presentation and frontend data
access. [Application architecture](../../docs/architecture.md) owns the server/UI
authority boundary; [build guidance](forge/on-build.md) owns tooling and acceptance.

## UI ownership

`App.tsx` owns providers and router integration; `Routes/` validates addresses and
passes selection/navigation through the review component's public interface. The
URL is the only record of selected path.

`ui/src/Components/WorkspaceReview/` owns the review experience:

| Owner | Responsibility |
| --- | --- |
| WorkspaceReview | Composes panes; owns filters, cross-pane selection/copy actions, layout and coordinated explicit Refresh |
| Owned WorkspaceData | Workspace identity and repository-context reads, independent failure/retry and freshness |
| Owned ChangeSetData | Comparison analysis and selected short/complete patch reads, cancellation, freshness and coordinated Refresh |
| ChangesNavigator | Controlled filters, hierarchy presentation, private tree projection and expansion/reveal lifecycle |
| SelectionViewer | Canonical selected-entry metadata, folder/repository summaries, signal details/disclosure and no-selection orientation, independently of navigator rows |
| ChangesSummary | Shared count/line-breakdown presentation used by header, navigator and viewer |
| SignalSummary | Shared warning/notice indicators and complete informational tooltip lists |

## Data and derived state

The DataLibs use the same QueryClient and manual/offline policy. They own endpoint
and query definitions; the review composes their public refresh operations rather
than maintaining another cache or refresh controller. Data access stays local to
this feature; external consumers enter through the feature's public interfaces.

Shared pure review analysis derives canonical selection subjects and count scopes
from server facts. It contains no rendered hierarchy or expansion. The navigator
alone projects display topology. It keeps repositories with real changes even when
filters hide every entry, retains unavailable repository placeholders whose state is
unknown, and omits available repositories confirmed to have no changes. Filtering,
omission or collapsing cannot remove the viewer's access to a selected subject.
Tree counts and selection summaries share the own-entry counting implementation,
not competing derivations. Derived analysis/projections are reused across unrelated
layout and clipboard updates.

## Selected-entry presentation

SelectionViewer composes the canonical subject, secondary analysis metadata, signals
and an owned FileDiff. Structural folders and repository placeholders issue no file
reads; an own changed entry still has a diff when it also has children. Signal sources come from direct server annotations and canonical child links,
including nested repositories and filtered entries. Inclusive server counts own
indicator presence; direct annotations determine strength independently per severity.
A shared traversal index retains each attributed message once and derives subject
lists on demand. Display placeholder parenting never creates signal membership.

WorkspaceReview coordinates inspection, source navigation and explicit reveal through
the panes' public props. Inspection selects without toggling and opens viewer details.
Source navigation preserves filters; reveal additionally unions the source's missing
categories and asks the navigator to expand its ancestors. Same-path actions create
a new request occurrence without adding history. These transient commands are not
another selection record. Each pane consumes an occurrence once when its selected
target resolves; newer commands and unrelated navigation invalidate pending work.

Disclosure belongs to SelectionViewer. Ordinary selection and history start collapsed;
explicit inspection reopens it, including a repeated action on the same subject.
Filters and Refresh preserve the user's choice while that subject and its signals
survive. Losing the last signal removes obsolete details and resets disclosure.
Messages always come from the accepted analysis observation: pending reads retain
them, and failed reads mark retained analysis stale through the existing data owner.
Navigator address resolution and explicit reveal have separate lifetimes, so a
topology-only Refresh does not reopen manually collapsed ancestors.

## Selected-file observations

ChangeSetData owns path/context query identity and the shared manual/offline read
policy. Selection acquires a fresh short observation; leaving cancels its reads
and releases inactive patch data. Explicit expansion alone acquires complete
context. Every new short request and coordinated Refresh retires complete context,
including when the short reload fails and leaves visibly stale usable content.
Expansion resumes only after the short read recovers successfully.
Refresh awaits analysis and the active short read; workspace-context retry remains
independent. Filters, signals and view mode do not change file request identity.

FileDiff owns the unified/split preference for the mounted review, observation-local
parser models, context compatibility, expansion and local recovery. Its private
presentation session accepts complete observations once and keeps short, hydrated,
incompatible, refused and failed context mutually exclusive. The view consumes the
session's model and recovery action; it does not maintain parallel lifecycle flags.
Incompatibility survives complete-context retirement and failed reloads until a
successful short-observation replacement mounts a new session. Its cooperating
header control shares only that presentation scope. Query caches renderer-neutral
API responses; mutable Pierre models stay inside FileDiff. File-response sides,
modes, ownership and baseline describe the displayed patch; analysis continues to
own the canonical tree, signals and totals. A disagreement labels the older summary
and offers coordinated Refresh.

Complete context is another live observation. Before hydrating short Git hunks,
the adapter verifies canonical side/baseline identity, changed-block coordinates,
payload/EOF and every represented short context line against reconstructed full
sides. Hunk merging alone does not reject compatibility. A mismatch preserves the
older short view and requires Reload file; this is no snapshot guarantee.
HTTP failures/refusals keep the short diff usable. Strict parser, renderer and
asynchronous highlighting failures stay within the file capability and report once
through the existing console destination. A failed renderer offers the literal plain
patch as a reading fallback. Metadata, signals and tree remain usable.

Pierre renders read-only Shadow DOM using its supported styling surface, bundled
Shiki JS resources and the fixed light theme. The released vanilla renderer exposes
the async highlight error callback needed for local containment; a small adapter
connects it to React's file view. No editor, worker pool or external resource loader
participates.
