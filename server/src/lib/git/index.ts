export { addedPairStatistics, compareIndexEntries, deletedPairStatistics } from "./internal/pair-statistics.ts";
export type { GitProcess, GitResult } from "./internal/process.ts";
export { createGitProcess, gitFailure, preflightRepository } from "./internal/process.ts";
export type { IndexEntry } from "./internal/scratch-index.ts";
export { withScratchIndex } from "./internal/scratch-index.ts";
