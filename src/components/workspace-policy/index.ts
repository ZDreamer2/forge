export type {
	CodebaseContext,
	RepositoryDeclaration,
	WorkspaceChange,
	WorkspacePolicy,
} from "./authoring/index.ts";
export { loadWorkspacePolicy } from "./internal/load.ts";
export type { RepositoryResolution } from "./internal/repositories.ts";
export { resolveRepositories } from "./internal/repositories.ts";
