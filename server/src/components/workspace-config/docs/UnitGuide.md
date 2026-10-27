# workspace-config Guide

Interprets the workspace's trusted authored configuration into data the rest of the server uses: registered concrete codebases, declared repositories, the display name and references to workspace and codebase analysis handlers.

## Notes

Not implemented yet. The current `workspace-policy` component loads `workspace.ts` with the earlier callback-based membership model; that responsibility moves here with the concrete-first migration. The configuration format, and how it converges with the registration Python Forge already reads, remain open. Converge on one interpretation rather than keeping two.

Holds authored knowledge only. Whether a declared repository exists, its Git root and its current state are observations owned by `workspace-repositories`. Configuration is loaded at startup and replaced on restart.

Codebase membership is a directory boundary: a path belongs to the registered codebase whose root is its closest containing ancestor, and a deeper root wins. This unit exposes registered roots; `workspace-tree` resolves owners from them. There are no per-change membership callbacks.

Authored configuration and handler modules are trusted executable project code, not a sandbox. Report authoring mistakes clearly, but do not build defensive machinery against the code itself.

This vocabulary is not a wire contract. `http-api` maps what clients need into `api-contract`.
