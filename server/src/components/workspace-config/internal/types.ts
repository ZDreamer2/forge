export interface RepositoryDeclaration {
	readonly path: string;
}

export interface ResolvedCodebase {
	readonly id: string;
	readonly root?: string;
	readonly guide: string;
	readonly parents: readonly string[];
}

export interface RootedCodebase extends ResolvedCodebase {
	readonly root: string;
}

export interface ResolvedWorkspaceGuide {
	readonly guide: string;
	readonly parents: readonly string[];
}

export interface UnavailableCodebase {
	readonly marker: string;
	readonly id?: string;
	readonly reason: string;
}

export type ResolvedGuide = ResolvedCodebase | ResolvedWorkspaceGuide;
export type GuideIdentity = `codebase:${string}` | "workspace";

export interface ResolvedGuideChain<Selected extends RootedCodebase | undefined = RootedCodebase | undefined> {
	readonly selected: Selected;
	readonly guides: readonly ResolvedGuide[];
}

export interface WorkspaceConfig {
	readonly displayName?: string;
	readonly repositories: readonly RepositoryDeclaration[];
	readonly workspace: ResolvedWorkspaceGuide;
	readonly guides: readonly ResolvedCodebase[];
	readonly unavailable: readonly UnavailableCodebase[];
}

export class WorkspaceConfigError extends Error {}
