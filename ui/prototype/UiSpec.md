---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge workspace review UI

## Purpose

Help a developer understand agent-produced changes across a workspace, decide what deserves attention, and inspect individual files without losing the overall change context. Repository boundaries orient the review; coordinated changes remain one workspace-level task.

This UiSpec owns the review experience and its rationale. The [application architecture](../../docs/architecture.md) and [server API contract](../../server/docs/protocol.md) own application boundaries and data semantics; issue specifications own delivery scope. The prototype demonstrates the design, not production acceptance.

[README](README.md) explains how to explore the demo and its limitations. [DesignDecisions](DesignDecisions.md) records concrete presentation choices. The prototype is a working example of this design, not an exhaustive specification of application behavior.

## Review experience

The developer first scans the size and distribution of workspace changes, narrows the visible files by type and importance, then selects a file to read its diff. Folder selection provides an intermediate overview. Warnings and notices direct attention to concerns that may need examination regardless of the file's importance.

The interface favors quick scanning followed by focused reading. A dense, readable tree carries navigation and summary information; the main area gives space to one selected file. Repeated labels, ordinary status badges, and implementation explanations stay out of the main working surface. Secondary information remains available through tooltips and expandable details.

The 100-file example exercises density, long paths, and coordinated repository changes. It is a layout exercise rather than a file-count limit or a suggested normal review batch size.

## Workspace and pane organization

- One compact header identifies the workspace, shows complete workspace totals, and offers explicit Refresh. Workspace identity replaces a repeated Forge text label; the F emblem remains beside it.
- The sidebar/main divider continues through the header and follows resizing. This makes the relationship between each header area and its pane clear. Tree controls stay near their associated filters and Changes summary.
- Header space beside workspace identity remains available for future primary navigation. The F emblem is intended to become the main-menu button later; no menu or additional screens are designed here yet.
- The sidebar width is persisted in LocalStorage and restored on subsequent visits, with resizing still usable when storage is unavailable. The sidebar and main content scroll independently. Compact rows expose more context without reducing name readability. The fixed-light appearance and restrained controls support sustained reading.
- The tree root displays the workspace name (`Bico 2` in the prototype), while its workspace-relative path remains `.` for selection identity, copying and navigation.
- One workspace-relative file/folder hierarchy includes repository roots at their actual paths, distinguished by a repository icon rather than separate groups, counters or empty states. Repository roots follow the same filtering and expansion behavior as ordinary folders: only branches leading to matching changes appear. Ancestors needed to reach nested repositories remain visible; directory-chain compaction preserves repository and codebase boundaries. Folder summaries include matching descendants across nested repositories, counting each changed file once. Filtering may hide a selected folder without clearing its selection; direct links and browser history retain its workspace-relative identity.

## Visual language

Separate meanings remain distinguishable so that one visual treatment does not erase another.

| Information | Presentation and meaning |
| --- | --- |
| File type | Recognizable neutral file-type icon. |
| Structural boundary | Yellow folder icons for ordinary directories; the same shape in blue-violet for actual repository roots. Repository and codebase boundaries are distinct concepts. Codebase roots have one bordered `c` marker immediately after the name, with hover/focus help naming the codebase and its guide directory; repository icons need no additional `r` marker. |
| Change kind | Name text: green added, red deleted, blue renamed/moved, neutral modified or mixed. Tree names have no metadata tooltips. |
| Importance | High bold, Medium regular, Low and None regular in a softer version of the change color. Low importance does not turn an added/deleted/moved name into unrelated gray text. |
| Selection | Row background and marker, preserving the name's change color and importance weight. |
| Analysis signals | Separate warning/notice symbols; importance and change styling remain intact. |

Low and None share visual emphasis while remaining separate filter categories. The UI displays analysis metadata rather than deciding which source code is important.

A folder name uses a change color only when all matching changes in its subtree share that kind. Its importance is the highest matching subtree importance, including its own change when present. These are UI projections, not Git directory operations or new server annotations.

## Filtering and totals

The filter dimensions are server-owned Type (Code, Tests, Docs, Config, Assets) and Importance (High, Medium, Low, None). Importance maps effective emphasis: High = emphasized, Medium = normal, Low = deemphasized, None = hidden. The UI displays analysis results rather than evaluating classification or importance policy. The [API contract](../../server/docs/protocol.md#analyze-workspace-changes) owns those semantics; the [demo examples](README.md#importance-examples) illustrate global suffix rules and project-scoped policies without implementing them.

Each category name is a toggle. Categories within a dimension combine with OR; the dimensions combine with AND. All types and High/Medium/Low start enabled; None starts disabled. Adjacent select-all and deselect-all actions affect both dimensions. This gives the developer control over attention while keeping lower-priority work accessible.

Workspace header file and line totals always cover all changes. The sidebar's matching/total file count retains the complete denominator. Folder line totals, including the workspace root, cover all matching descendant files regardless of expansion. The Changes-line totals are labeled Shown and cover only matching files with no collapsed ancestor, counting each file once and never including folder aggregates. They recalculate when expansion or filters change. The Shown label has a hover/focus tooltip explaining that collapsed descendants are excluded and scrolling does not affect the total. Filtered totals are never presented as the full size of the workspace change.

Removed lines occupy the left numeric column, added lines the right. Consistent right alignment supports scanning additions and deletions independently. Zero values are blank while their column space remains; binary changes and pure renames can have no displayed line counts without ceasing to be changes.

Change counters have no tooltips. File and Shown counters have stronger visual weight than regular, subdued folder counters, distinguishing actual file changes from aggregate subtree totals. Signal tooltips, control help, and the Shown explanation remain available.

### Folder overview

Selecting a folder shows its workspace-relative path in the existing header. The matrix's All × All cell supplies matching file and line totals; do not duplicate them in a separate summary row. When filters exclude files, show “M of N files” inline beside the matrix title, with hover/focus help explaining matching/complete scopes and expansion independence. Omit this count when all files match, except that an empty matrix retains “0 of N files” beside its title. Counts include nested repositories and are independent of expansion; the folder page has no Shown total.

Above the matrix, Context separates repository identity from a Forge guidance table:

- Display the server-provided application order, including workspace parents and shared ancestors once. Folder ancestry alone does not imply inheritance; the UI does not rebuild the chain.
- Source labels distinguish Workspace parent, Workspace, Project parent and Project folder; the workspace row is visually distinct. All entries participate, without a current-status label. When base/current ownership differs, label each side's context separately.
- Rootless guides have no folder root. Guide-name hover/focus help shows the guide directory; help beside Forge guidance explains ordering. Keep these explanations out of permanent prose.
- Roots are workspace-relative, with `.` displayed as Workspace. Guide directories outside the workspace may be absolute. Available workspace roots select folders without toggling; an unchanged registered root remains selectable without a tree row or invented changes. Missing side ownership is explicit rather than inferred.
- Context remains independent of filters and excludes descendant codebases merely nested beneath the selection.

A Type-by-Importance matrix shows each matching intersection as file count / added lines / removed lines on one line, with no repeated file-count noun. Hovering or focusing the matrix title explains the order as “Files / added lines / removed lines”; no permanent legend is shown. Nonempty cells show explicit +0/−0 when there are no line changes, distinguishing them from empty intersections. Types are rows and importance levels are columns, with equal visual weight for both axes; their filter-like labels are informational, not controls. All is the first row and first data column: the column gives each type's total, the row gives each importance total, and their intersection is the complete matching-subtree total. Categories with no matching files are omitted, but categories containing only binary changes or pure renames remain with their file counts. Empty intersections are distinguishable from matching files with no line changes. A matching set with no line changes has an explicit explanation; a fully filtered-out set shows a no-matching-changes state while retaining its complete denominator. The matrix is informational and does not change global filters. The existing signal panel retains filtered-out sources and reveal actions. The folder page does not duplicate the tree as a descendant file list or aggregate diff excerpts.

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

There is at most one selected tree item across files and folders. Clicking its name selects it; clicking again clears selection. Disclosure arrows independently control expansion. On first encounter, folders whose matching subtree has only Low/None importance start collapsed; a Medium/High matching descendant keeps the folder expanded by default. These defaults use the highest matching subtree importance, including nested repositories. Subsequent filter changes preserve established expansion choices; newly encountered folders receive the default. Collapse all and Expand all apply to every matching folder, including descendants of collapsed branches, and sit beside the Changes label. Revealing a signal source expands all its ancestors, including newly exposed Low/None branches. Folder selection shows the matching-subtree overview; file selection shows one diff.

Ctrl+Click selects and copies the workspace-relative path, keeping an already selected item selected. Repository roots copy their workspace-relative root, including `.` for the workspace root. Successful copies are silent and do not shift the layout; clipboard failures remain visible. A keyboard-help tooltip exposes implemented shortcuts without permanently labeling each control.

Workspace-relative paths give consistent identity across nested repositories, copied references, and signal messages. The single-line file header shows that path with stronger filename emphasis and the unified/split switch, without counters or repeated repository labels. Each header path segment copies the workspace-relative path through that segment on click or Enter/Space, without navigating. Mouse dragging selects text normally and does not copy to the clipboard. Hover/focus help shows the copied prefix and explains click-to-copy and drag-to-select. Long paths scroll horizontally rather than hiding selectable segments. Rename-source and binary/metadata explanations belong below the header. Long diff lines wrap in both unified and split layouts, preserving indentation and breaking long unspaced tokens rather than clipping content. Line numbers and change markers stay aligned with the first visual line.

Selection is URL-addressable and supports browser history. Filtering retains a meaningful selection even if it becomes invisible in the tree, with an explicit notice. Refresh should retain meaningful navigation and presentation state and explain when a selected file disappears.

## Observation and scope

Review is read-only and proceeds through explicit Refresh. A failed refresh leaves retained content visibly stale and offers recovery. A file-level failure should preserve usable navigation. Initial-load, retry, context-expansion failure, and refresh reconciliation are application requirements whose full interaction design is not established by the demo's scenario switches.

The intended renderer provides unified/split diffs and on-demand omitted context using the accepted patch API and Pierre. Binary, metadata-only, and other nontext changes need explicit explanations. The prototype only illustrates part of that behavior. Comments, reviewed flags, checkpoints, agent controls, and Git mutations remain outside this viewer design.

Path search remains outside this design. Category filters and tree navigation provide selection. File/directory transitions retain one canonical entry: count its own change and descendants once, preserving both-side ownership and selectable identity. Prototype fixtures do not exhaust production topology, failure states or browser behavior; installed-browser acceptance verifies the delivered application.
