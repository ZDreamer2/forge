export type { FileComparison, FilePatchInput } from "./internal/file-patch.ts";
export { createFilePatch, FILE_PATCH_LIMIT, FILE_RAW_LIMIT } from "./internal/file-patch.ts";
export { addedPairStatistics, compareIndexEntries, deletedPairStatistics } from "./internal/pair-statistics.ts";
export type { GitProcess, GitResult } from "./internal/process.ts";
export { createGitProcess, GitOutputLimitError, gitFailure, preflightRepository } from "./internal/process.ts";
export type { IndexEntry } from "./internal/scratch-index.ts";
export { withScratchIndex } from "./internal/scratch-index.ts";
