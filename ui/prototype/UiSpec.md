---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge workspace review UI

## Purpose and status

Help a developer understand agent-produced changes across a workspace, decide what deserves attention, and inspect individual files without losing the overall change context. Repository boundaries orient the review; coordinated changes remain one workspace-level task.

This UiSpec records the intended experience developed through the HTML prototype. It includes chosen design directions and their reasons. The [application architecture](../../docs/architecture.md) and [server API contract](../../server/docs/protocol.md) own application boundaries and data semantics; issue specifications own the accepted scope of individual changes. Chunk 12 supplies the server classification contract; Chunks 13–15 cover navigation/filtering, signal inspection and Pierre integration. This document does not establish their implementation or acceptance. The selected viewer uses server-owned Type classification, the existing-emphasis mapping and initial filters described here, file/folder navigation and signal reveal, while deferring path search.

[README](README.md) explains how to explore the demo and its limitations. [DesignDecisions](DesignDecisions.md) records concrete presentation choices. The prototype is a working example of this design, not an exhaustive specification of application behavior.

## Review experience

The developer first scans the size and distribution of workspace changes, narrows the visible files by type and importance, then selects a file to read its diff. Folder selection provides an intermediate overview. Warnings and notices direct attention to concerns that may need examination regardless of the file's importance.

The interface favors quick scanning followed by focused reading. A dense, readable tree carries navigation and summary information; the main area gives space to one selected file. Repeated labels, ordinary status badges, and implementation explanations stay out of the main working surface. Secondary information remains available through tooltips and expandable details.

The 100-file example exercises density, long paths, and coordinated repository changes. It is a layout exercise rather than a file-count limit or a suggested normal review batch size.

## Workspace and pane organization

- One compact header identifies the workspace, shows complete workspace totals, and offers explicit Refresh. Workspace identity replaces a repeated Forge text label; the F emblem remains beside it.
- The sidebar/main divider continues through the header and follows resizing. This makes the relationship between each header area and its pane clear. Tree controls stay near their associated filters and Changes summary.
- Header space beside workspace identity remains available for future primary navigation. The F emblem is intended to become the main-menu button later; no menu or additional screens are designed here yet.
- The sidebar and main content scroll independently. Compact rows expose more context without reducing name readability. The fixed-light appearance and restrained controls support sustained reading.
- The tree root displays the workspace name (`Bico 2` in the prototype), while its workspace-relative path remains `.` for selection identity, copying and navigation.
- One workspace-relative file/folder hierarchy includes repository roots at their actual paths, distinguished by a repository icon rather than separate groups, counters or empty states. Repository roots follow the same filtering and expansion behavior as ordinary folders: only branches leading to matching changes appear. Ancestors needed to reach nested repositories remain visible; directory-chain compaction preserves repository boundaries. Folder summaries include matching descendants across nested repositories, counting each changed file once. Filtering may hide a selected folder without clearing its selection; direct links and browser history retain its workspace-relative identity.

## Visual language

Separate meanings remain distinguishable so that one visual treatment does not erase another.

| Information | Presentation and meaning |
| --- | --- |
| File type | Recognizable neutral file-type icon. |
| Structural boundary | Yellow folder icons for ordinary directories; the same shape in blue-violet for actual repository roots. Repository and codebase boundaries are distinct concepts. |
| Change kind | Name text: green added, red deleted, blue renamed/moved, neutral modified or mixed. Descriptive change text remains available in tooltips. |
| Importance | High bold, Medium regular, Low and None regular in a softer version of the change color. Low importance does not turn an added/deleted/moved name into unrelated gray text. |
| Selection | Row background and marker, preserving the name's change color and importance weight. |
| Analysis signals | Separate warning/notice symbols; importance and change styling remain intact. |

Low and None share visual emphasis while remaining separate filter categories. The UI displays analysis metadata rather than deciding which source code is important.

In the current design, a folder name uses a change color only when all visible descendant changes share that kind. Its importance is the highest among visible descendants. These are presentation projections to reconcile with the analysis contract, not claims about Git directory operations or new server annotations.

## Filtering and totals

The selected dimensions are Type (Code, Tests, Docs, Config, Assets) and Importance (High, Medium, Low, None). Type is server-owned analysis metadata with Forge-base defaults adopted through ordinary guide composition, trusted handler overrides and Code as engine fallback. Every analyzed node carries `classification: {value, reason?, handler?}` with lowercase values `code`, `tests`, `docs`, `config`, `assets`. Each node starts as Code; sequential `classifyNode` assignments replace its category and provenance, including explicit Code. Fallback has no invented handler. Classification is node-local and never inherits. The whole tree finishes classification before annotation begins, so annotation hooks can inspect final categories. Renames classify once at their destination, deletions at their old path; both-side ownership stays independent. Structural categories do not classify descendants or create changed entries.

Forge-base assigns Docs, Config, Assets and finally Tests using its path rules; Tests wins collisions and later guide handlers can replace results. A workspace without adopted policies retains Code, normal emphasis and no signals. These server/policy contracts are independent of browser filtering. Importance maps existing effective emphasis: High = emphasized, Medium = normal, Low = deemphasized, None = hidden; server inheritance, provenance and reasons remain authoritative. Fixture assignments such as tests being Low or plans being None illustrate possible analysis decisions rather than changing Forge-base's existing emphasis policy.

Each category name is a toggle. Categories within a dimension combine with OR; the dimensions combine with AND. All types and High/Medium/Low start enabled; None starts disabled. Adjacent select-all and deselect-all actions affect both dimensions. This gives the developer control over attention while keeping lower-priority work accessible.

Workspace header file and line totals always cover all changes. The sidebar's matching/total file count retains the complete denominator. Folder line totals, including the workspace root, cover all matching descendant files regardless of expansion. The Changes-line totals are labeled Shown and cover only matching files with no collapsed ancestor, counting each file once and never including folder aggregates. They recalculate when expansion or filters change. The Shown label has a hover/focus tooltip explaining that collapsed descendants are excluded and scrolling does not affect the total. Filtered totals are never presented as the full size of the workspace change.

Removed lines occupy the left numeric column, added lines the right. Consistent right alignment supports scanning additions and deletions independently. Zero values are blank while their column space remains; binary changes and pure renames can have no displayed line counts without ceasing to be changes.

Line-count tooltips provide independent Type and Importance breakdowns. They use light, aligned tables, omit rows with no line changes, and have no redundant column-heading rows. These breakdowns explain the counts without adding persistent category counters to the filter controls.

## Warnings and notices

Signals communicate concerns independently of type, importance, or change kind. An unimportant file can still need attention. Signals retain their originating path, severity, message, producing handler, and optional base/current line and column.

- Amber triangles identify warnings; quieter information circles identify notices. Tree icons have no adjacent numbers.
- A strong icon indicates a signal attached directly to that item. A subdued folder/repository icon indicates descendant-only signals. Each severity is evaluated independently, so a direct notice does not strengthen an inherited warning. This distinction helps locate the actual sources.
- Hover or focus shows a table of severity icon, workspace-relative path, and message. There is no numeric heading or visible Severity label. Both severity icons expose the item's complete signal list. Folder paths have trailing slashes.
- Clicking an indicator selects the item without toggling an existing selection off and opens the same structured messages below the single-line main header. Ordinary selection leaves a collapsed message summary. Details retain secondary handler/location information and a bounded scrolling area.
- Folder and repository signal summaries include filtered-out sources, including sources in nested repositories. Filtering controls which tree branches appear, not the contents of signal summaries on surviving ancestors or selected folders. A repository with no matching descendants has no tree row; its signals remain discoverable through a surviving ancestor or retained selection.
- Filtered-out messages identify that state. Reveal file enables the relevant missing categories, expands the file's ancestors, selects it, and keeps messages open while preserving unrelated expansion state. Message file paths can also open the associated file.

The server owns direct signals and inclusive counts. A signal attached to a folder is distinct from a descendant signal summarized there. The prototype's fixture aggregation demonstrates the presentation, not an alternative analysis system. No separate warning filter is currently designed.

## Selection, identity, and file reading

There is at most one selected tree item across files and folders. Clicking its name selects it; clicking again clears selection. Disclosure arrows independently control expansion. Collapse all and Expand all sit beside the Changes label. Folder selection shows a visible-file summary; file selection shows one diff.

Ctrl+Click selects and copies the workspace-relative path, keeping an already selected item selected. Repository roots copy their workspace-relative root, including `.` for the workspace root. Brief feedback reports copy success or failure. A keyboard-help tooltip exposes implemented shortcuts without permanently labeling each control.

Workspace-relative paths give consistent identity across nested repositories, copied references, and signal messages. The single-line file header shows that path with stronger filename emphasis and the unified/split switch, without counters or repeated repository labels. Long paths shorten middle directories to preserve the filename; the full path remains available on hover. Rename-source and binary/metadata explanations belong below the header.

Selection is URL-addressable and supports browser history. Filtering retains a meaningful selection even if it becomes invisible in the tree, with an explicit notice. Refresh should retain meaningful navigation and presentation state and explain when a selected file disappears.

## Observation, scope, and unresolved design

Review is read-only and proceeds through explicit Refresh. A failed refresh leaves retained content visibly stale and offers recovery. A file-level failure should preserve usable navigation. Initial-load, retry, context-expansion failure, and refresh reconciliation are application requirements whose full interaction design is not established by the demo's scenario switches.

The intended renderer provides unified/split diffs and on-demand omitted context using the accepted patch API and Pierre. Binary, metadata-only, and other nontext changes need explicit explanations. The prototype only illustrates part of that behavior. Comments, reviewed flags, checkpoints, agent controls, and Git mutations remain outside this viewer design.

Path search remains deferred; category filters and tree navigation are the selected first-delivery controls. The server-owned Type contract belongs to Chunk 12; browser category filtering belongs to Chunk 13. Folder color and highest-visible importance remain UI presentation projections, not new server annotations.

Remaining questions to resolve with implementation planning:

- Chunk 13: unobtrusive canonical codebase boundaries, both-side ownership and file/directory transitions against real analysis data, including a node that owns both a change and children. Count each canonical changed entry once. Repository examples do not settle these cases.
- Chunk 13: typed URL representation for one file/folder selection, including root `.`, direct loads and history. The former file-only query proposal is not fixed.
- Chunk 13: safe folder-chain compaction that preserves boundaries, direct signal sources, selectable identity and changed transition nodes. The fixture tree does not establish the production hierarchy.
- Chunk 14: signal-details/reveal integration with Chunk 13's navigation, including filtered-out and disappearing sources, refresh and browser history. Signals are a separately accepted layer; neither navigation nor signal delivery requires Pierre.
- Chunks 13–15: complete load/refresh/file/context failure and recovery presentation, preserving the accepted freshness/data-owner contract. Chunk 15 owns Pierre and final viewer integration.

The prototype and this UiSpec guide subsequent work. Integration into the existing application, complete edge-state behavior, and installed-browser acceptance remain separate implementation responsibilities.
