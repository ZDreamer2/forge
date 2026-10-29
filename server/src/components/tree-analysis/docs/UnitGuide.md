# tree-analysis Guide

Runs trusted handlers over a per-request facade of a workspace tree. Base source
facts stay shared with light requests; annotations and source-size caches belong
to one analysis invocation. `http-api` supplies source access under app-owned
cancellation, so this component does not depend on a particular tree source.

## Handler authoring

The package's type-only `@zdreamer/forge/analysis` entry exports `AnalysisHandler`
and supported root/node/annotation vocabulary. A module default-exports
`handler(root)`, synchronously returning void or a promise that completes all its
work. Native TypeScript uses erasable syntax, type-only imports and explicit
relative extensions. YAML `analysis_handlers` references explicit relative
`.ts`, `.mts`, `.js` or `.mjs` files. Modules load once at startup; restart refreshes
them. Ordinary Node ESM module caching applies.

Every handler sees the workspace root, including codebase handlers.
`root.handler.codebase` identifies the registering owner and grants no subtree
restriction. `root.signal` carries cooperative cancellation.
`root.source.currentByteSize(node)` returns the byte size of a current regular
file, without reading content; invalid or foreign nodes and failed observations
reject. Successful and failed lookups are reused within that run.

Nodes expose readonly source facts and projected owners, parent/children
navigation and a synchronous preorder `walk()` including self. The root has no
parent. Rename ancestry follows its canonical destination path. Explicit emphasis
and direct signals remain readable by subsequent handlers. Derived effective
emphasis, inclusive signal counts and totals are calculated only after handlers.

Use `deemphasize(reason)`, `restoreNormalEmphasis(reason?)`, `emphasize(reason)` or
`hide(reason)`. Use `warn(message, location?)` or `notice(message, location?)`;
optional locations have `side`, one-based `line` and optional one-based `column`.
The active handler identity is attached automatically. Later emphasis on the same
node wins; the nearest explicitly annotated ancestor controls inheritance. A
normal reset restores attention beneath a hidden/deemphasized ancestor. Signals
accumulate and remain visible through all emphasis levels.

## Execution and failures

Built-ins run first, then workspace occurrences in YAML order, then codebase
occurrences in registry/list order. Every configured occurrence runs, including
repeated references. One handler finishes before the next starts. Synchronous
walks do not await each node. The built-ins deemphasize workspace-root `plans/`
and directories named exactly `tests` or `Tests`. They warn for current added,
modified or content-edited renamed Markdown files strictly above 20,480 bytes,
excluding current paths under root `plans/`, pure moves, deletions and symlinks.
Size reads are lazy and bounded to two concurrent candidate reads.

Import/default-export errors are retained in the startup registry rather than
breaking light APIs. Loading or invocation failure rejects the whole analysis
with the safe configured occurrence ID. Raw causes stay in server diagnostics,
not HTTP errors. Cancellation stops awaiting async work, observes late rejection
and prevents later handlers/finalization. It cannot preempt synchronous JavaScript
or detached work: handlers are trusted executable code, without a sandbox.

Startup-loaded functions may run concurrently for different requests. Authors
must keep invocation state local, await all their work and stop using run-scoped
roots, nodes and source capabilities on return. Do not retain them in module state
or launch detached callbacks. This is an authoring contract, not runtime policing
of arbitrary JavaScript.
