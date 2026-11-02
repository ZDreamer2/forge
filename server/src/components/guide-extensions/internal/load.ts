import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	guideIdentity,
	resolveGuideChain,
	resolveWorkspaceChain,
	rootedCodebases,
	type WorkspaceConfig,
} from "../../workspace-config/index.ts";
import type { ForgeExtension } from "./authoring.ts";
import { GuideExtensionLoadError, type LoadedGuideExtension } from "./types.ts";

function validate(value: unknown): ForgeExtension {
	if (
		typeof value !== "object" ||
		value === null ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
	)
		throw new TypeError("Guide extension requires a default-exported plain object");
	for (const key of Reflect.ownKeys(value))
		if (key !== "api" && key !== "annotateNode" && key !== "classifyNode")
			throw new TypeError(`Unknown guide extension member: ${String(key)}`);
	const extension = value as Record<string, unknown>;
	if (extension.api !== 1) throw new TypeError("Guide extension requires supported api revision 1");
	if (Object.hasOwn(extension, "annotateNode") && typeof extension.annotateNode !== "function")
		throw new TypeError("Guide extension annotateNode must be callable");
	if (Object.hasOwn(extension, "classifyNode") && typeof extension.classifyNode !== "function")
		throw new TypeError("Guide extension classifyNode must be callable");
	return extension as unknown as ForgeExtension;
}

export async function loadGuideExtensions(config: WorkspaceConfig): Promise<readonly LoadedGuideExtension[]> {
	// Resolve every required chain before executing any trusted module.
	const chains = [
		resolveWorkspaceChain(config),
		...rootedCodebases(config).map((owner) => resolveGuideChain(config, owner)),
	];
	const guides = new Map(
		chains.flatMap((chain) => chain.guides.map((guide) => [guideIdentity(guide), guide] as const)),
	);
	const extensions: LoadedGuideExtension[] = [];
	for (const [id, guide] of guides) {
		const unit = join(guide.guide, "forge-extension");
		try {
			try {
				await lstat(unit);
			} catch (error) {
				if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
					continue;
				throw error;
			}
			const extension = validate((await import(pathToFileURL(join(unit, "forge-extension.ts")).href)).default);
			extensions.push({
				id,
				...(extension.classifyNode === undefined ? {} : { classifyNode: extension.classifyNode }),
				...(extension.annotateNode === undefined ? {} : { annotateNode: extension.annotateNode }),
			});
		} catch (cause) {
			extensions.push({ id, error: new GuideExtensionLoadError(id, cause) });
		}
	}
	return extensions;
}
