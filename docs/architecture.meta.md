# architecture.meta.md

Specification for creating and editing [Forge application architecture](architecture.md). Defines purpose, usage patterns, and constraints.

## architecture.md goals and principles

- Gives maintainers a high-level map for assigning responsibilities and judging changes to dependencies, authority and lifetimes. It explains consequential boundaries and their rationale, rather than cataloging the source tree.
- Distinguishes one package/installation from its server and frontend codebases. Shared distribution does not merge runtime environments, implementation ownership or verification scopes.
- Preserves the server's authority over the selected workspace, the server-owned browser-safe API contract and the separation of authored policy from wire vocabulary. These boundaries prevent clients from reconstructing competing workspace models or importing server internals.
- Records architectural decisions at the level that changes when responsibilities or significant dependencies change. Helpers, file moves, command flags and algorithm steps belong to their owning code, tests or operating documentation, not a second implementation description.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing architecture.md

- [StartSimple methodology](AI_DOC_PLUGIN/Theory/StartSimple.md) - Keeps the map focused on established architectural needs instead of anticipatory layers or implementation inventories.

## MAY read for additional context before editing architecture.md

- [HTTP API contract](../server/docs/protocol.md) - Relevant when changing client/server obligations, observable lifecycle or workspace-operation side effects; owns precise wire semantics.
- [Application README](../README.md) - Relevant when changing package or operating boundaries; owns current runtime support, source layout, configuration and commands.
- [Server planning entry](../server/docs/forge/on-plan.md) - Relevant when reconciling an application-specific responsibility with shared service conventions. Machine-checked edges and library confinement are in `server/.dependency-cruiser.mjs` and `.dependency-cruiser.mjs`.

## architecture.md typical use context

### 💡 Distinct usage patterns for architecture.md

#### Loaded during application planning

Application planning entry -> architecture map -> affected API or codebase guidance when needed.

#### Direct reference for a responsibility change

`Assess where a new workspace capability belongs using docs/architecture.md in the Forge application repository.`

### Role architecture.md serves during use

- Shared orientation for server/frontend maintainers deciding ownership and allowed interactions.
- Rationale for architectural constraints without duplicating contracts, setup instructions or source implementation.
