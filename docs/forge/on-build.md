---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge application installation verification

Run root `check` with the pinned installation. It covers server/UI source checks
and packed installed API/Chromium acceptance. The
[README](../../README.md#develop) owns commands and explicit dependency/browser
setup; checks install nothing.

[Server guidance](../../server/docs/forge/on-build.md) covers API/Git/lifecycle
verification; [UI guidance](../../ui/docs/forge/on-build.md) binds frontend checks
to this host. Use the aggregate gate for shared installation changes.
