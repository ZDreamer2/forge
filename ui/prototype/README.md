# Forge interface design sandbox

Open `index.html` in a browser. No installation, build, live Forge server, or network access is needed. Classic scripts and bundled assets support direct local-file opening. All workspace data is fictional; this page does not inspect your checkout.

[UiSpec](UiSpec.md) explains the intended experience, behavior, and rationale. [DesignDecisions](DesignDecisions.md) retains concrete presentation and asset notes.

## Explore the demo

- Toggle file types and importance categories. The None importance category starts disabled; all types and High/Medium/Low start enabled. Select-all/deselect-all icons affect both dimensions.
- Explore one workspace tree: the `Bico 2` root (workspace-relative path `.`) contains the nested repository at `library/tools/forge`, marked with the repository icon. Filters prune all empty branches, including repository roots; ancestor summaries include matching nested-repository files once.
- Select files or folders; click the selected name again to clear selection. Ctrl+Click selects and copies its workspace-relative path.
- Low/None-only matching branches start collapsed; branches containing Medium/High changes start expanded. Filter changes preserve established expansion choices.
- Use disclosure arrows or the collapse/expand icons beside Changes. Shown counts line changes in matching files exposed by expansion, not the scroll viewport; hover or focus its label for an explanation. Folder counters always include all matching descendants.
- Hover or focus a bordered `c` beside a folder name to see its codebase and guide directory. Repository roots use the colored folder icon without a separate badge.
- Select a folder for Context and the Type-by-Importance matrix. Context separates the repository from explicit guide composition, including workspace parents; hover or focus guide names for their directories. Root links select their folders. All totals come first in the matrix; a filtered file count appears inline beside its title. Hover or focus the title for cell-value help.
- Click a header path segment to copy the workspace-relative path through it, or focus it and press Enter/Space. Drag to select text normally; long paths scroll horizontally.
- Resize the sidebar by dragging the divider or focusing it and using Left/Right. Its width is restored from LocalStorage on subsequent visits.
- Switch unified/split views; TenderList includes long text and an unbroken URL to demonstrate wrapping. Tree names and change counters have no tooltips; hover or focus signal icons for structured messages.
- Click a signal icon to open details below the main header. BiCo includes a warning on filtered-out plans; Reveal file enables the needed categories and expands its ancestors. Forge includes a direct repository notice and a located file notice.
- Use browser Back/Forward to revisit selections. The keyboard icon lists shortcuts.
- Open the information button for the Example menu: normal, 100-file, failed-refresh, and empty-workspace scenarios. Retry restores the normal example.

## Importance examples

These are authored fixture outcomes, not executable classification rules. Use the High/Medium/Low filters and folder matrix to inspect them:

| Example | Importance and scope |
| --- | --- |
| `src/Modules/Tender/styles/list.css` and Forge's `ui/src/review.css` | Low: global CSS suffix rule applies in both repositories. |
| `src/Core/Review/ReviewPolicy.php` | High: Bicotender Core path policy. |
| `src/Domain/Review/ReviewScope.php` and `src/Modules/Tender/Domain/Tender.php` | High: Bicotender Domain directories at different depths under `src/`. |
| `src/Core/Review/panel.css`, `panel.phtml`, and `src/Modules/Tender/Domain/Templates/panel.blade.php` | Low: global suffix rules take precedence over high-importance paths. |
| `library/vendor/example/Normalizer.php` | Low: Bicotender vendor path policy. |
| `TenderList.tsx`, `EmptyState.tsx`, and Forge's `WorkspaceHeader.tsx` | Medium: ordinary-code fallback. |
| Forge's `server/src/Core/ReviewPolicy.ts` and `library/vendor/example/Normalizer.ts` | Medium: Bicotender path policy does not apply in the independent Forge repository. |

Core/Domain folders containing High files remain expanded while their Low-only branches collapse by default. Tests remain Low and planning/lockfile examples retain None as separate illustrative annotations; those are not additional digest importance rules. The 100-file scenario retains these cases and fills the remaining rows with ordinary Medium files and Low test examples. No digest hidden/map-only modes are imported.

## Files and assets

- `index.html`: application shell.
- `styles.css`: appearance and pane layout.
- `fixtures.js`: example changes and analysis signals across two repositories.
- `app.js`: HTML rendering and interaction state.
- `icons.js`: inline adaptations of local SVG assets.
- `fonts/`: JetBrains Mono 2.304 and its license, `OFL.txt`.
- `icons/`: Material Icon Theme assets, local adaptations, source revision, and license.

## Prototype limits

Types, importance, guide composition, tree construction, and analysis signals are authored fixtures; the page does not implement the production server contract. Counts and excerpts are authored separately.

Diff rendering has no syntax highlighting, aligned split rows, patch parsing, or real context loading. Refresh, failure, and empty states are demonstrations, not API integration. Production retains the accepted API/data owner and uses Pierre.

For browser automation that blocks local-file navigation, serve this directory over loopback HTTP. Prototype visual and fixture-interaction checks are not production application acceptance.
