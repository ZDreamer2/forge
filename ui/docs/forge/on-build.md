---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# Forge UI implementation

Run from the independent Forge installation root with its `.nvmrc` Node first on
PATH. [README setup](../../../README.md#develop) owns commands, frozen dependency
installation and explicit Chromium setup; checks install nothing.

Keep browser/test ambient types in `ui/tsconfig*.json`; `ui/tsconfig.tools.json`
checks Node-side Vite/Vitest configuration separately. The TypeScript, Vite and graph bindings
resolve `@forge/api-contract` to the same public server entry.

The personal checker runs `check:ui`. Route additions, copies, deletions or renames
first trigger `build:ui` to regenerate `src/Routes/routeTree.gen.ts` through Vite's
TanStack plugin. Retain the generated file. Validation checks its currency before
building; for manual preparation run `build:ui`. Build-and-serve is the supported
development path.

Focused renders use `ForgeTheme` with `env="test"`. Vitest's setup is
`ui/vitest.setup.ts`; tests use the foundation `/testing` lifecycle directly,
with application-owned providers and fixtures.

`check:ui` verifies frontend source, configuration and build without compiling the
server or running its suite. Root `check` also exercises the
packed installed application in Chromium. `test:ui` is focused behavior feedback,
not aggregate acceptance.
