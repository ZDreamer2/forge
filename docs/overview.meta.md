# overview.meta.md

Specification for creating and editing the [Forge codebase overview](overview.md). Defines purpose, usage patterns, and constraints.

## overview.md goals and principles

- Orients maintainers to the whole Forge application repository before they select task-specific guidance. It explains the repository's purpose, source layout, runtime shape and documentation routes without requiring the full architecture and operating contracts.
- Keeps repository orientation separate from product vision, detailed architecture, API semantics and operating instructions. Their owning documents remain authoritative, so the overview can stay stable as those details evolve.
- Covers server, UI, shared tooling and distribution as parts of one application package while preserving their distinct responsibilities and verification needs.
- Avoids release history, issue status and implementation inventories that would make the repository's entry point require constant synchronization.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing overview.md

- [StartSimple methodology](AI_DOC_PLUGIN/Theory/StartSimple.md) - Keeps this high-altitude entry point limited to orientation and routes that are useful across repository tasks.
- [Application architecture](architecture.md) - Owns the authority, component and lifecycle boundaries that the overview summarizes; prevents the orientation from becoming a competing architectural contract.
- [Forge README](../README.md) - Owns setup, commands, configuration and usage; keeps operating detail out of the overview.

## MAY read for additional context before editing overview.md

- [Workspace server API](../server/docs/protocol.md) - Relevant when changing how the overview routes readers to API behavior.
- [UI architecture](../ui/docs/architecture.md) - Relevant when changing frontend source or ownership orientation.
- [Release operations](releasing.md) - Relevant when changing distribution and publication routes.

## overview.md typical use context

### 💡 Distinct usage patterns for overview.md

#### Direct reference before repository work

`Plan changes in library/tools/forge using library/tools/forge/docs/overview.md as the entry point.`

#### Loaded indirectly from Forge task context

Server/UI issue -> branch context references the codebase overview -> reader follows task-specific architecture, protocol, UI or operating documents

### Role overview.md serves during use

- Entry point for understanding the repository and locating the correct source area and authoritative documentation.
- Shared orientation for server, UI, tooling and distribution tasks, without replacing their concrete guides.
