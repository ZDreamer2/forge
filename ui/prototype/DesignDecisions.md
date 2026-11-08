# Forge viewer presentation notes

Updated: 2026-11-01. [UiSpec](UiSpec.md) owns the intended experience, behavior, rationale, and unresolved questions. This file retains concrete visual choices from the HTML iterations; it is a presentation reference, not a transcript or an application acceptance record. [README](README.md) owns demo setup and limitations.

## Layout and density

- Keep the fixed-light appearance. The sidebar/main split continues through the header and shares one width value during resizing.
- The workspace name is Bico 2 at 20px, including narrower viewport widths. The F-to-name gap is 9px.
- Use JetBrains Mono at 13px for tree names, with Consolas/system monospace fallbacks. Code excerpts use 12px.
- Use compact 25px tree rows with minimal name/disclosure padding. Disclosure arrows sit immediately left of folder icons, inside the indentation gutter rather than a separate spaced flex column. Root icons start 19px from the sidebar edge; files and folders at the same depth share icon/name alignment. Each nesting level shifts exactly one 17px icon width to the right, including on narrower viewports. Tree-row items use a compact 3px gap, bringing names closer to their icons. Repository roots occupy ordinary rows in the workspace hierarchy, without separate group spacing or repository-owned file counts.
- Keep line-count columns right-aligned and in the same scrolling area as the sidebar summary so scrollbar width does not shift their alignment.
- Use subtle row hover backgrounds without underlining or changing name styling. Selection uses a background and left marker.

## Emblem

The custom SVG F has angled arm ends on a muted copper-bronze tile (`#876649` base). Warm ivory, faint grain, a defined upper bevel, lower inset shadow, and raised letter give tactile depth without a bright polished finish. Its industrial/workshop character is inspired in spirit by Factorio.

The tile is 34 by 36px with 7px corners. Keep it static and compact. Its future menu role and header-space intentions are described in UiSpec; the prototype has no menu behavior.

## Icons, names, and tooltips

- File icons use neutral gray. Ordinary folder icons use muted yellow; repository roots use the same folder silhouette in blue-violet.
- Added/deleted/renamed names use green/red/blue respectively, with neutral text for modified or mixed entries. High importance is bold; Low and None use softer versions of the same change color. UiSpec owns their meanings and aggregation rules.
- Warning symbols are amber and notice symbols quieter blue-gray. Descendant-only signal indicators use 40% opacity, increasing on hover/focus; direct sources remain at full strength.
- Tree names and change counters have no tooltips. Folder counters use subdued aggregate styling; file counters remain stronger. Signal and help tooltips use light surfaces. Signal tables use a narrow icon column followed by path and message.
- Folder pages show a compact scope summary and a Type-by-Importance matrix. Both axes use equally weighted, non-interactive filter-style tiles with a subtle green fill. The table uses its natural content width rather than stretching across the pane. Subtle vertical dividers separate columns, matching the horizontal row rules. Cells use one compact line in count / +added / −removed order, explained by a small legend; nonempty cells retain explicit zero counters. The first All row and data column have no background fill; their labels use the same tiles as other axis labels. File counts retain binary/rename-only categories; empty intersections use a dash. The matrix scrolls horizontally when space is limited.
- Long diff lines wrap within both unified and split panes, including unbroken tokens. Gutters stay anchored at the first visual line.
- Type and importance names act as subtly filled toggle buttons; their group labels remain available to assistive tools.

## Asset provenance

The locally bundled font is JetBrains Mono 2.304; see `fonts/OFL.txt`. SVGs come from Material Icon Theme with monochrome adaptations; `icons/SOURCE.txt` records the source revision and modifications and `icons/LICENSE` retains the license. The simple folder shape removes the original source-code motif. The prototype uses that same shape for repositories, distinguished by color.

These choices can evolve with the prototype. Update UiSpec when a visual change alters meaning, behavior, or rationale rather than merely tuning presentation.
