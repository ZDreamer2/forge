---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Installed UI assets

`ui-assets` delivers the built application at `/` and `/assets/`, without
workspace-data or domain dependencies. App composition supplies the asset
directory, resolving installed `dist/ui/` relative to the compiled server module
so delivery is independent of the invocation directory.

The global Host/Origin loopback guard runs before dispatch. Only existing files
within the asset directory are served; unknown paths and missing assets return
404. There is no directory listing or catch-all HTML fallback. API behavior belongs
to `http-api`.
