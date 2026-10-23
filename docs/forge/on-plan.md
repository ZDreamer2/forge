# Forge application installation

The repository owns one published `@zdreamer/forge` artifact and one pnpm
installation, with all dependencies declared in its root manifest. Read
[architecture](../architecture.md) for server/UI ownership and the public API boundary and [README](../../README.md) for aggregate development commands.

Server work follows [server planning guidance](../../server/docs/forge/on-plan.md),
with `server/` as the service root. The React application is reserved at `ui/src/`;
its concrete frontend planning/build entries and host integration are not yet
implemented. The server owns browser-safe API types in its `api-contract` component;
the UI consumes that public entry rather than server implementation.
