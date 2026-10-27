# workspace-repositories Guide

Owns the workspace's participating Git repositories: resolving declarations at startup, their status and Git roots, and which workspace paths participate. Every capability reading or operating on local Git state uses this one participation rule.

## Notes

Not implemented yet. Repository probing currently lives in `workspace-policy`, and path participation in `workspace-changes` internals.

Probe declared repositories only; never scan for additional clones. A repository missing at startup stays excluded until restart; loss of an available repository is a failure, not a silently smaller result.

Participating paths stay inside the workspace even when the main Git root extends above it. Declared nested repositories are distinct participants; undeclared clones and gitlinks are excluded together with their contents; Git internals are excluded; symbolic links are identified, never traversed.

Sources reading local state and later coordinated staging/commit operations share this participation. A narrower reviewed list must never authorize a broader unchecked staging sweep, so keep one rule rather than per-operation variants.

Read-only toward source files and Git metadata.
