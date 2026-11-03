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
| SelectionViewer | Canonical selected-entry metadata, folder/repository summaries and no-selection orientation, independently of navigator rows |
| ChangesSummary | Shared count/line-breakdown presentation used by header, navigator and viewer |

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

SelectionViewer currently displays metadata, not file content. Future signal and
diff capabilities extend the established ownership boundaries; renderer-specific
models remain frontend-owned and file failures must not disable navigation.
