export {
	findCodebaseRoot,
	guideIdentity,
	mergeGuideSequences,
	resolveCodebaseChain,
	resolveGuideChain,
	resolveWorkspaceChain,
} from "./internal/guide-chains.ts";
export { loadWorkspaceConfig, validRepositoryPath } from "./internal/load.ts";
export { rootedCodebases } from "./internal/rooted-codebases.ts";
export type {
	GuideIdentity,
	RepositoryDeclaration,
	ResolvedCodebase,
	ResolvedGuide,
	ResolvedGuideChain,
	ResolvedWorkspaceGuide,
	RootedCodebase,
	UnavailableCodebase,
	WorkspaceConfig,
} from "./internal/types.ts";
export { WorkspaceConfigError } from "./internal/types.ts";
