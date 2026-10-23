# protocol.meta.md

Specification for creating and editing the [workspace server API contract](protocol.md). Defines purpose, usage patterns, and constraints.

## protocol.md goals and principles

- Describes the server-owned public interface so server and client builders can implement the same boundary without reverse-engineering the other side. The web UI and Forge CLI motivate the contract, but its obligations do not depend on caller count or client implementation libraries.
- Owns inputs, results, side effects, and meaningful failures. Components, storage, and internal delegation belong elsewhere. In particular, workspace operations can partially complete: a failure response does not necessarily mean nothing changed.
- Defines the contract independently of implementation status and release planning. Implementation progress and MVP objectives belong elsewhere; the contract itself neither reports runtime support nor proves verification. Unresolved semantics remain explicit rather than hidden behind plausible wire shapes. Future-capability placeholders do not promise operations.
- Keeps scope proportional to a personal developer tool and actual client interactions. Version negotiation, extension frameworks, exhaustive error taxonomies, and a satellite-document structure need demonstrated value, not anticipatory completeness.
- Makes the architectural boundary precise without silently changing it. A method that requires an unsettled architectural choice exposes that choice for resolution. Temporary Python/TypeScript duplication is compatible with the contract, which describes behavior rather than its implementation.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing protocol.md

- [Application architecture](../../docs/architecture.md) - Owns server/client responsibilities, the shared wire boundary and authoritative-workspace lifecycle; the protocol makes these boundaries concrete rather than redefining them.
- [StartSimple methodology](AI_DOC_PLUGIN/Theory/StartSimple.md) - Supports a small useful contract whose detail grows from concrete interactions rather than a general-purpose API framework.

## MAY read for additional context before editing protocol.md

- [Application README](../../README.md) - Relevant when distinguishing authored contract semantics from current runtime support, configuration and package consumption.

## protocol.md typical use context

### 💡 Distinct usage patterns for protocol.md

#### Direct reference during server or client implementation

`Implement the workspace changes API using server/docs/protocol.md in the Forge application repository.`

Either builder uses the contract for its side of the interaction; internal source exploration is not a substitute for shared obligations.

### Role protocol.md serves during use

- Shared API reference for server, UI, and CLI builders.
- Concrete basis for discussing proposed interactions and identifying unresolved boundary semantics.
