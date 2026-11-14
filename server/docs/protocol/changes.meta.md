# changes.meta.md

Specification for creating and editing the [workspace changes and file-diff contract](changes.md). Defines purpose, usage patterns, and constraints.

## changes.md goals and principles

- Enables server and client builders to implement change discovery, comparison, ownership and file-diff behavior without recovering semantics from internal components.
- Owns the detailed public semantics that the main API contract summarizes. The main contract retains shared HTTP rules and the operation map; this document retains enough local context to make its detailed rules usable.
- Preserves workspace-scoped authorization, bounded and cancellable observation, meaningful failures and read-only limits as architectural boundaries rather than implementation details.
- Describes observable behavior independently of runtime support, release planning and internal component delegation. Analysis-specific response metadata belongs to the analysis contract.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing changes.md

- [Workspace server API](overview.md) - Owns shared access and failure rules plus the operation summaries that lead readers here; edits must preserve that division without conflicting duplicates.
- [Application architecture](../../../docs/architecture.md) - Owns workspace authority, participation and lifecycle boundaries that this contract makes observable.
- [StartSimple methodology](AI_DOC_PLUGIN/Theory/StartSimple.md) - Keeps detailed semantics tied to actual client interactions rather than speculative API capabilities.

## changes.md typical use context

### 💡 Distinct usage patterns for changes.md

#### Usage inherited from the API overview

`changes.md` is a satellite of the [workspace server API](overview.md). Usage initially
follows the overview's change-operation references; direct usage has not yet been observed.

### Role changes.md serves during use

- Normative reference for workspace comparison, ownership, observation and file-patch behavior.
- Detailed companion to the main API overview for server, UI and CLI builders.
