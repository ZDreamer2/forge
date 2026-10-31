# Forge UI

The standalone React application lives in `ui/src/`, with `main.tsx` as its mount
entry. Server and UI share one root package and lockfile.
[Architecture](../../../docs/architecture.md) owns their authority boundary;
[build guidance](on-build.md) supplies tooling and acceptance bindings.

Vite emits to `dist/ui/`. The installed server serves `/` and exact `/assets/`
files behind its loopback guard; unknown paths remain 404s. TanStack's Vite plugin
explicitly generates the committed route tree.

API calls use the same origin. The exact type-only `@forge/api-contract` alias
resolves to `server/src/components/api-contract/index.ts`; the server owns change
semantics and line totals. The app supplies fixed-light Mantine styling and
console reporting for unexpected failures. Shared frontend guidance owns data,
component and recovery conventions.
