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
| Owned ChangeSetData | Comparison analysis reads and freshness; the owning seam for related patch reads when delivered |
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
alone projects display topology, including registered-repository placeholders;
filtering or collapsing it cannot remove the viewer's access to a selected subject.
Tree counts and selection summaries share the own-entry counting implementation,
not competing derivations. Derived analysis/projections are reused across unrelated
layout and clipboard updates.

## Selected-entry presentation

SelectionViewer displays metadata and signals; file content and diffs remain future
work. Signal sources come from direct server annotations and canonical child links,
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

Future diff capabilities extend these boundaries; renderer-specific models remain
frontend-owned and file failures must not disable navigation.
