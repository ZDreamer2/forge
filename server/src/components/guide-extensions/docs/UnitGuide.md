---
edit-only-context: AI_DOC_PLUGIN/Formats/BaseDoc/BaseDoc.format.md
---

# guide-extensions Guide

Discovers and loads trusted guide extension modules. The
[shared authoring contract](../../../../../../../../ai/bc-plugins/dev/forge/docs/theory/codebases/guide-part/extension/forge-extension.md)
owns unit layout, compatibility, applicability and author obligations.

At startup, after configuration chain validation, this component discovers each
distinct guide in the workspace and available rooted participant chains once.
Unrelated rootless guides are not loaded. An absent `forge-extension/` contributes
nothing; a present unit requires `forge-extension.ts`. Native erasable TypeScript
ESM supports explicit local imports. Ordinary Node module caching applies; restart
refreshes the loaded registry.

Entries default-export a plain object with `api: 1` and optional callable
`classifyNode` and `annotateNode`. Unknown members, unsupported revisions, malformed
exports and import failures become retained per-guide errors. Composition logs their raw diagnostics
and passes contributions to `tree-analysis`; that owner decides applicability at
request time. A broken unrelated participant does not block analysis.

The npm `@zdreamer/forge/extension` subpath targets compiled
`internal/authoring.ts`, exposing named type-only exports: `ForgeExtension`, supported
hook/context types and required readonly tree and classification vocabulary. The
component's `index.ts` instead exposes engine loader operations and types.

This component depends on `workspace-config` for guide discovery and
[tree-analysis](../../tree-analysis/docs/UnitGuide.md) for hook contracts, phase
scheduling and capability lifetimes. That component never imports this aggregate;
app composition passes loaded hooks to it.
