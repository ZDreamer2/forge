export type WorkspaceIdentity = {
	workspace: { root: string; name: string };
	repositories: ({ path: string; status: "available"; gitRoot: string } | { path: string; status: "missing" })[];
};

export type ApiErrorCode = "forbidden" | "not_found" | "method_not_allowed" | "internal_error";

export type ApiFailure = {
	error: { code: ApiErrorCode; message: string; handler?: string };
};

export type WorkspaceChanges = {
	codebases: Record<string, { root: string; guidance: string; type?: string }>;
	changes: {
		repo: string;
		path: string;
		kind: "added" | "modified" | "deleted" | "renamed";
		from?: string;
		codebases: string[];
	}[];
};

export type AnalysisHandlerDefinition = { id: string; codebase?: string };
export type AnalysisEmphasis = "normal" | "emphasized" | "deemphasized" | "hidden";
export type AnalysisSignal = {
	severity: "notice" | "warning";
	message: string;
	handler: string;
	location?: { side: "base" | "current"; line: number; column?: number };
};
export type AnalysisSide = {
	path: string;
	kind: "directory" | "file" | "symlink";
	repository?: string;
	codebase?: string;
	repositoryRoot?: string;
	codebaseRoot?: string;
};
export type AnalysisSetting = { value: AnalysisEmphasis; reason?: string; handler: string };
export type AnalysisWireNode = {
	path: string;
	children: string[];
	repo?: string;
	kind?: "added" | "modified" | "deleted" | "renamed";
	from?: string;
	renameContentChanged?: boolean;
	base?: AnalysisSide;
	current?: AnalysisSide;
	statistics?: { added: number; removed: number; binary: boolean };
	emphasis?: AnalysisSetting;
	signals: AnalysisSignal[];
	effectiveEmphasis: { value: AnalysisEmphasis; reason?: string; handler?: string; origin?: string };
	signalCounts: { notice: number; warning: number };
	rawTotals: { added: number; removed: number };
	attentionTotals: { added: number; removed: number };
};
export type WorkspaceAnalysis = {
	root: ".";
	nodes: Record<string, AnalysisWireNode>;
	codebases: WorkspaceChanges["codebases"];
	handlers: Record<string, AnalysisHandlerDefinition>;
};
