import { relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkspaceConfig } from "../../workspace-config/index.ts";
import { codebaseFacts } from "../../workspace-tree/index.ts";
import { AnalysisHandlerError, type RegisteredAnalysisHandler } from "./types.ts";
export async function loadAnalysisHandlers(
	config: WorkspaceConfig,
	workspaceRoot: string,
): Promise<readonly RegisteredAnalysisHandler[]> {
	const registry: RegisteredAnalysisHandler[] = [];
	const owners = [
		{ references: config.analysisHandlers ?? [], codebase: undefined },
		...config.codebases.map((codebase) => ({
			references: codebase.analysisHandlers ?? [],
			codebase: codebaseFacts(codebase),
		})),
	];
	for (const { references, codebase } of owners)
		for (const reference of references) {
			const identity = {
				id: codebase
					? `codebase:${relative(workspaceRoot, codebase.root).split(sep).join("/") || "."}:${reference.ordinal}`
					: `workspace:${reference.ordinal}`,
				...(codebase ? { codebase } : {}),
			};
			try {
				if (!/\.(?:m?js|m?ts)$/.test(reference.modulePath))
					throw new TypeError("Analysis handler must use an explicit ESM JavaScript or TypeScript extension");
				const loaded: unknown = (await import(pathToFileURL(reference.modulePath).href)).default;
				if (typeof loaded !== "function") throw new TypeError("Analysis handler requires a default-exported function");
				registry.push({ identity, handler: loaded as RegisteredAnalysisHandler["handler"] });
			} catch (cause) {
				registry.push({ identity, error: new AnalysisHandlerError(identity, cause) });
			}
		}
	return registry;
}
