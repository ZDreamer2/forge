---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge UI implementation

Run from the independent Forge installation root with its `.nvmrc` Node first on
PATH. [README setup](../../../README.md#develop) owns commands, frozen dependency
installation and explicit Chromium setup; checks install nothing.

Keep browser/test ambient types in `ui/tsconfig*.json` and Node-side Vite/Vitest
configuration in the root tooling program. The TypeScript, Vite and graph bindings
resolve `@forge/api-contract` to the same public server entry.

After route changes, `build` regenerates `src/Routes/routeTree.gen.ts` through
Vite's TanStack plugin. Retain the generated file; acceptance checks its currency
without rewriting it. Build-and-serve is the supported development path.

Focused renders use `ForgeTheme` with `env="test"`. Vitest's setup is
`ui/vitest.setup.ts`; tests use the foundation `/testing` lifecycle directly,
with application-owned providers and fixtures.

`check:ui` verifies the UI and production build. Root `check` also exercises the
packed installed application in Chromium. `test:ui` is focused behavior feedback,
not aggregate acceptance.
