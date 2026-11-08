# Forge interface design sandbox

Open `index.html` in a browser. No installation, build, live Forge server, or network access is needed. Classic scripts and bundled assets support direct local-file opening. All workspace data is fictional; this page does not inspect your checkout.

[UiSpec](UiSpec.md) explains the intended experience, behavior, and rationale, including unresolved application-contract questions. [DesignDecisions](DesignDecisions.md) retains concrete presentation and asset notes.

## Explore the demo

- Toggle file types and importance categories. The None importance category starts disabled; all types and High/Medium/Low start enabled. Select-all/deselect-all icons affect both dimensions.
- Explore one workspace tree: the `Bico 2` root (workspace-relative path `.`) contains the nested repository at `library/tools/forge`, marked with the repository icon. Filters prune all empty branches, including repository roots; ancestor summaries include matching nested-repository files once.
- Select files or folders; click the selected name again to clear selection. Ctrl+Click selects and copies its workspace-relative path.
- Use disclosure arrows or the collapse/expand icons beside Changes. Shown counts line changes in matching files exposed by expansion, not the scroll viewport; hover or focus its label for an explanation. Folder counters always include all matching descendants.
- Resize the sidebar by dragging the divider or focusing it and using Left/Right.
- Switch unified/split views. Hover or focus line counts for breakdowns and signal icons for structured messages.
- Click a signal icon to open details below the main header. BiCo includes a warning on filtered-out plans; Reveal file enables the needed categories and expands its ancestors. Forge includes a direct repository notice and a located file notice.
- Use browser Back/Forward to revisit selections. The keyboard icon lists shortcuts.
- Open the information button for the Example menu: normal, 100-file, failed-refresh, and empty-workspace scenarios. Retry restores the normal example.

## Files and assets

- `index.html`: application shell.
- `styles.css`: appearance and pane layout.
- `fixtures.js`: example changes and analysis signals across two repositories.
- `app.js`: HTML rendering and interaction state.
- `icons.js`: inline adaptations of local SVG assets.
- `fonts/`: JetBrains Mono 2.304 and its license, `OFL.txt`.
- `icons/`: Material Icon Theme assets, local adaptations, source revision, and license.

## Prototype limits

This is a design sandbox, not delivery of Chunks 10–13. Types, importance, tree construction, and analysis signals are authored fixtures; the page does not implement the production server contract. Counts and excerpts are authored separately.

Diff rendering has no syntax highlighting, aligned split rows, patch parsing, or real context loading. Refresh, failure, and empty states are demonstrations, not API integration. Production retains the accepted API/data owner and uses Pierre.

For browser automation that blocks local-file navigation, serve this directory over loopback HTTP. Prototype visual and fixture-interaction checks are not production application acceptance.
