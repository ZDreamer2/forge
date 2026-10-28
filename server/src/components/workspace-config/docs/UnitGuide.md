# workspace-config Guide

Interprets the workspace's trusted authored configuration into data the rest of the server uses: registered concrete codebases, declared repositories, the display name and references to workspace and codebase analysis handlers.

## Notes

`index.ts` exposes `loadWorkspaceConfig` and the resolved registry vocabulary. The loader reads data only; it does not import workspace modules or load analysis handlers.

The source is the same `forge-workspace.yaml` Python Forge reads, in the folder selected by `ZD_AI_FORGE_WORKSPACE_GUIDE` (default `docs/forge/workspace`), and the concrete `forge-codebase.yaml` and type files it references. There is one codebase registry; the server never re-declares codebases. `workspace.ts`, its public `./workspace` authoring types and the policy checks in consuming workspaces are removed; a consuming workspace's installation remains only to exact-pin the `forge` executable. The required `repositories` list contains normalized workspace-relative strings (`.` is allowed); optional `display_name` is preserved exactly and falls back to the workspace basename in application composition. Python ignores keys it does not read and keeps its repository scan until it adopts the declared list.

Configuration is data: loading it executes no project code. Registry rules (reference resolution, root/type validation, duplicate-root errors) are temporarily implemented here and in Python. Keep them equivalent, at least by checking both against the real workspace, until Python commands become clients of the server.

Holds authored knowledge only. Whether a declared repository exists, its Git root and its current state are observations owned by `workspace-repositories`. Configuration is loaded at startup and replaced on restart.

Repositories are declared, never discovered: a new nested clone participates only once declared.

Codebase membership is a directory boundary: a path belongs to the registered codebase whose root is its closest containing ancestor, and a deeper root wins. This unit exposes registered roots; `workspace-tree` resolves owners from them. There are no per-change membership callbacks.

Handlers are the only authored code: later TypeScript modules referenced from the YAML (workspace handlers from `forge-workspace.yaml`, codebase handlers from `forge-codebase.yaml`), trusted and not sandboxed. Their authoring types become a new public export when `tree-analysis` is implemented. Report authoring mistakes clearly, but do not build defensive machinery against trusted code.

This vocabulary is not a wire contract. `http-api` maps what clients need into `api-contract`.
