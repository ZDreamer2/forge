# overview.meta.md

Specification for creating and editing the [workspace server API contract](overview.md). Defines purpose, usage patterns, and constraints.

## overview.md goals and principles

- Describes the server-owned public interface so server and client builders can implement the same boundary without reverse-engineering the other side. The web UI and Forge CLI motivate the contract, but its obligations do not depend on caller count or client implementation libraries.
- Defines shared inputs, results, side effects and meaningful failures, with detailed operation semantics owned by linked satellites. Components, storage, and internal delegation belong elsewhere. In particular, workspace operations can partially complete: a failure response does not necessarily mean nothing changed.
- Defines the contract independently of implementation status and release planning. Implementation progress and MVP objectives belong elsewhere; the contract itself neither reports runtime support nor proves verification. Unresolved semantics remain explicit rather than hidden behind plausible wire shapes. Future-capability placeholders do not promise operations.
- Provides the API map and owns shared rules plus cohesive operations. Detailed change/file and analysis semantics belong to their satellites; main-document summaries preserve decision-critical guarantees and link to the owning contract rather than duplicating its detail.
- Keeps scope proportional to a personal developer tool and actual client interactions. Version negotiation, extension frameworks and exhaustive error taxonomies need demonstrated value, not anticipatory completeness.
- Makes the architectural boundary precise without silently changing it. A method that requires an unsettled architectural choice exposes that choice for resolution. Temporary Python/TypeScript duplication is compatible with the contract, which describes behavior rather than its implementation.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing overview.md

- [Workspace changes and file diffs](changes.md) - Owns detailed comparison, ownership, observation and file-diff semantics summarized by the main contract.
- [Workspace change analysis](analysis.md) - Owns detailed analyzed-tree semantics summarized by the main contract.
- [Application architecture](../../../docs/architecture.md) - Owns server/client responsibilities, the shared wire boundary and authoritative-workspace lifecycle; the protocol makes these boundaries concrete rather than redefining them.
- [StartSimple methodology](AI_DOC_PLUGIN/Theory/StartSimple.md) - Supports a small useful contract whose detail grows from concrete interactions rather than a general-purpose API framework.

## MAY read for additional context before editing overview.md

- [Application README](../../../README.md) - Relevant when distinguishing authored contract semantics from current runtime support, configuration and package consumption.

## overview.md typical use context

### 💡 Distinct usage patterns for overview.md

#### Direct reference during server or client implementation

`Implement the workspace changes API using server/docs/protocol/overview.md in the Forge application repository.`

Either builder starts with the operation map and shared rules, then follows the change or analysis link when implementing those details. Internal source exploration is not a substitute for shared obligations.

### Role overview.md serves during use

- API overview and shared-operation reference for server, UI, and CLI builders.
- Navigation to detailed change and analysis contracts.
- Concrete basis for discussing proposed interactions and identifying unresolved boundary semantics.
