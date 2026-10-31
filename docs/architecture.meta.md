# architecture.meta.md

Editing context for [application architecture](architecture.md).

## architecture.md goals and principles

- Helps maintainers assign responsibilities and judge dependency, authority and lifetime changes. It records consequential boundaries, not an implementation inventory.
- Keeps the component map aligned with machine-checked edges. Per-component design belongs in UnitGuides; operating and wire details have separate owners.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing architecture.md

- [StartSimple](AI_DOC_PLUGIN/Theory/StartSimple.md) - Grounds additions in demonstrated architectural needs.

## MAY read for additional context

- [API contract](../server/docs/protocol.md) - For observable semantics and effects.
- [README](../README.md) - For configuration and commands.
- [Server planning](../server/docs/forge/on-plan.md) - For service conventions; graph rules live in the installation and server dependency-cruiser configs.

## architecture.md typical use context

### Distinct usage patterns

Application planning loads this map before affected implementation guides; maintainers also consult it directly for ownership changes.

### Role during use

Decision context for component boundaries and allowed interactions, without requiring operating or implementation detail.
