# analysis.meta.md

Specification for creating and editing the [workspace change-analysis contract](analysis.md). Defines purpose, usage patterns, and constraints.

## analysis.md goals and principles

- Enables server and client builders to implement the analyzed-tree response without reconstructing its wire semantics from guide execution internals.
- Owns public node, guidance, classification, emphasis, signal and handler-inventory semantics. The main API contract retains the operation summary; the change contract retains shared comparison, ownership and observation rules.
- Keeps public analysis guarantees distinct from internal hook capabilities and scheduling, while preserving the relationships clients rely on between them.
- Describes contract behavior independently of implementation status and release planning, with atomic failure and startup/restart boundaries explicit.

## AiDocFormat

[BaseDoc format](AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md)

## MUST read before editing analysis.md

- [Workspace server API](overview.md) - Owns shared HTTP rules and the analysis operation summary; edits must keep the overview accurate without duplicating detailed semantics.
- [Workspace changes and file diffs](changes.md) - Owns comparison, owner definitions and shared observation/effects rules used by analysis.
- [Application architecture](../../../docs/architecture.md) - Owns server/client responsibilities and the boundary between observed trees and analysis enrichment.
- [Tree-analysis guide](../../src/components/tree-analysis/docs/UnitGuide.md) - Owns internal hook capabilities, ordering and execution semantics that the public contract references rather than redefines.
- [StartSimple methodology](AI_DOC_PLUGIN/Theory/StartSimple.md) - Keeps the analysis wire contract proportional to demonstrated client needs.

## analysis.md typical use context

### 💡 Distinct usage patterns for analysis.md

#### Usage inherited from the API overview

`analysis.md` is a satellite of the [workspace server API](overview.md). Usage initially
follows the overview's analysis-operation reference; direct usage has not yet been observed.

### Role analysis.md serves during use

- Normative reference for analyzed-tree responses and their public annotation semantics.
- Boundary between API consumers and the internal tree-analysis implementation.
