export interface RepositoryDeclaration {
	readonly path: string;
}

export interface ResolvedCodebaseType {
	readonly id: string;
	readonly guide: string;
}

export interface ResolvedAnalysisHandler {
	readonly modulePath: string;
	readonly ordinal: number;
}

export interface ResolvedCodebase {
	readonly analysisHandlers?: readonly ResolvedAnalysisHandler[];
	readonly root: string;
	readonly guide: string;
	readonly type?: ResolvedCodebaseType;
}

export interface WorkspaceConfig {
	readonly analysisHandlers?: readonly ResolvedAnalysisHandler[];
	readonly displayName?: string;
	readonly repositories: readonly RepositoryDeclaration[];
	readonly codebases: readonly ResolvedCodebase[];
	readonly codebaseTypes: readonly ResolvedCodebaseType[];
}

export class WorkspaceConfigError extends Error {}
