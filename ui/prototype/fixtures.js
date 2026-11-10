// Presentation fixtures only. These do not interpret or read the real workspace.
window.forgeGuides = [
	{ id: "forge-base", name: "Forge base", directory: "ai/bc-plugins/dev/forge/codebases/base", parents: [] },
	{ id: "workspace", name: "BiCo workspace", root: ".", directory: "docs/forge/workspace", parents: ["forge-base"] },
	{
		id: "react",
		name: "React frontend",
		directory: "ai/bc-plugins/dev/forge/codebases/ts-react-frontend",
		parents: [],
	},
	{
		id: "typescript",
		name: "TypeScript service",
		directory: "ai/bc-plugins/dev/forge/codebases/ts-service",
		parents: [],
	},
	{ id: "web", root: ".", name: "Web application", directory: "docs/code", parents: [] },
	{
		id: "forge",
		root: "library/tools/forge",
		name: "Forge application",
		directory: "library/tools/forge/docs/forge",
		parents: [],
	},
	{
		id: "forge-server",
		root: "library/tools/forge/server",
		name: "Forge server",
		directory: "library/tools/forge/server/docs/forge",
		parents: ["typescript", "forge"],
	},
	{
		id: "forge-ui",
		root: "library/tools/forge/ui",
		name: "Forge UI",
		directory: "library/tools/forge/ui/docs/forge",
		parents: ["react", "forge"],
	},
];
window.forgeCodebases = window.forgeGuides.filter((guide) => guide.root !== undefined && guide.id !== "workspace");
window.forgeFixtures = [
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Modules/Tender/Components/TenderList.tsx",
		kind: "M",
		added: 12,
		removed: 4,
		lines: [
			[" ", 'import { TenderCard } from "./TenderCard";'],
			[" ", ""],
			[" ", "export function TenderList({ tenders, isLoading }) {"],
			["-", "  if (!tenders.length) return null;"],
			["+", "  if (isLoading) {"],
			["+", "    return <TenderListSkeleton />;"],
			["+", "  }"],
			[" ", ""],
			["+", "  if (tenders.length === 0) {"],
			["+", '    return <EmptyState title="No tenders found" />;'],
			["+", "  }"],
			[" ", ""],
			[" ", "  return ("],
			["-", '    <div className="tender-list">'],
			["+", '    <section aria-label="Search results" className="tender-list">'],
			[
				"+",
				'      <p className="review-note">Search results include active tenders from every selected region, with matching procurement categories, publication dates, customer details, and submission deadlines available without leaving the review.</p>',
			],
			[
				"+",
				'      <a href="https://example.invalid/tenders/very-long-workspace-reference-without-breaks-0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz">Open tender reference</a>',
			],
			[" ", "      {tenders.map((tender) => ("],
			[" ", "        <TenderCard key={tender.id} tender={tender} />"],
			[" ", "      ))}"],
			["-", "    </div>"],
			["+", "    </section>"],
			[" ", "  );"],
			[" ", "}"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Modules/Tender/Components/EmptyState.tsx",
		kind: "A",
		added: 18,
		removed: 0,
		lines: [
			["+", "export function EmptyState({ title }) {"],
			["+", "  return ("],
			["+", '    <div className="empty-state">'],
			["+", "      <h2>{title}</h2>"],
			["+", "      <p>Try adjusting your search filters.</p>"],
			["+", "    </div>"],
			["+", "  );"],
			["+", "}"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Modules/Tender/styles/list.css",
		kind: "M",
		added: 9,
		removed: 2,
		lines: [
			[" ", ".tender-list {"],
			["-", "  display: flex;"],
			["+", "  display: grid;"],
			["+", "  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));"],
			[" ", "  gap: 16px;"],
			[" ", "}"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Documentation",
		path: "docs/tender-search.md",
		from: "docs/search.md",
		kind: "R",
		added: 0,
		removed: 0,
		message: "This file was renamed without content changes.",
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "www/img/tender-empty.png",
		kind: "A",
		added: 0,
		removed: 0,
		message: "Binary file · Image preview is outside this prototype.",
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Tooling",
		path: "pnpm-lock.yaml",
		kind: "M",
		added: 36,
		removed: 28,
		hidden: true,
		lines: [
			[" ", "lockfileVersion: 9.0"],
			[" ", ""],
			[" ", "importers:"],
			[" ", "  .:"],
			["-", "    version: 1.0.0"],
			["+", "    version: 1.0.1"],
		],
	},
	{
		repo: "Forge",
		root: "library/tools/forge",
		codebase: "Forge UI",
		path: "library/tools/forge/ui/src/Components/WorkspaceHeader.tsx",
		kind: "M",
		added: 7,
		removed: 3,
		lines: [
			[" ", "export function WorkspaceHeader({ workspace, refresh }) {"],
			[" ", "  return ("],
			[" ", "    <header>"],
			[" ", "      <h1>{workspace.name}</h1>"],
			["-", "      <button onClick={refresh}>Reload</button>"],
			["+", "      <button onClick={refresh}>Refresh</button>"],
			[" ", "    </header>"],
			[" ", "  );"],
			[" ", "}"],
		],
	},
	{
		repo: "Forge",
		root: "library/tools/forge",
		codebase: "Forge UI",
		path: "library/tools/forge/ui/src/Components/LegacySummary.tsx",
		kind: "D",
		added: 0,
		removed: 14,
		lines: [
			["-", "export function LegacySummary({ count }) {"],
			["-", "  return <p>{count} changes</p>;"],
			["-", "}"],
		],
	},
];

// Explicit, fictional analysis metadata. The production server owns classification.
const fixtureMetadata = [
	["code", "medium"],
	["code", "medium"],
	["code", "low"],
	["doc", "medium"],
	["assets", "medium"],
	["config", "none"],
	["code", "medium"],
	["code", "medium"],
];
window.forgeFixtures.forEach((file, index) => {
	[file.type, file.importance] = fixtureMetadata[index];
});
window.forgeFixtures.push(
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Modules/Tender/tests/TenderList.test.tsx",
		type: "tests",
		importance: "low",
		kind: "A",
		added: 24,
		removed: 0,
		lines: [
			["+", 'it("shows an empty state when no tenders match", () => {'],
			["+", "  render(<TenderList tenders={[]} isLoading={false} />);"],
			["+", '  expect(screen.getByText("No tenders found")).toBeVisible();'],
			["+", "});"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Planning",
		path: "plans/forge-viewer/DesignNotes.md",
		type: "doc",
		importance: "none",
		kind: "A",
		added: 32,
		removed: 0,
		lines: [
			["+", "# Viewer design notes"],
			["+", ""],
			["+", "Explore independent type and importance filters."],
		],
	},
	{
		repo: "Forge",
		root: "library/tools/forge",
		codebase: "Forge UI",
		path: "library/tools/forge/ui/src/Legacy/OldHeader.tsx",
		type: "code",
		importance: "medium",
		kind: "D",
		added: 0,
		removed: 16,
		lines: [["-", "export const OldHeader = () => <h1>Forge</h1>;"]],
	},
);

// Illustrative server-owned analysis signals. They are independent of importance.
window.forgeFixtures[0].signals = [
	{
		severity: "warning",
		message: "The loading and empty-state branches changed together. Check that loading never flashes an empty result.",
		handler: "workspace:review-ui",
	},
];
window.forgeFixtures.find((file) => file.path.endsWith("WorkspaceHeader.tsx")).signals = [
	{
		severity: "notice",
		message: "Refresh wording changed; verify the matching recovery action uses the same term.",
		handler: "codebase:forge-ui",
		location: { side: "current", line: 23, column: 7 },
	},
];
window.forgeFixtures.find((file) => file.path.startsWith("plans/")).signals = [
	{
		severity: "warning",
		message: "These design notes still reference a retired content endpoint.",
		handler: "workspace:documentation-links",
		location: { side: "current", line: 20 },
	},
];
window.forgeFixtures.push({
	repo: "BiCo",
	root: ".",
	codebase: "Documentation",
	path: "docs/architecture/WorkspaceReviewGuide.md",
	type: "doc",
	importance: "medium",
	kind: "M",
	added: 16,
	removed: 5,
	signals: [
		{
			severity: "warning",
			message: "Markdown file is larger than 20 KiB (24 KiB). Consider splitting it into focused documents.",
			handler: "builtin:large-markdown",
		},
	],
	lines: [
		[" ", "# Workspace review guide"],
		[" ", ""],
		["-", "Review each repository separately."],
		["+", "Review coordinated workspace changes together."],
	],
});
window.forgeFolderSignals = [
	{
		repo: "Forge",
		path: "library/tools/forge",
		signals: [
			{
				severity: "notice",
				message: "This repository includes UI and tooling changes. Review their integration together.",
				handler: "workspace:cross-cutting-review",
			},
		],
	},
];

// Authored importance outcomes, not a browser-side policy implementation.
// Suffix examples are global; Core/Domain/vendor path examples belong to BiCo only.
window.forgeFixtures.push(
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Core/Review/ReviewPolicy.php",
		type: "code",
		importance: "high",
		kind: "M",
		added: 6,
		removed: 2,
		lines: [
			[" ", "<?php"],
			["-", "return $changes;"],
			["+", "return $policy->review($changes);"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Domain/Review/ReviewScope.php",
		type: "code",
		importance: "high",
		kind: "M",
		added: 4,
		removed: 1,
		lines: [
			[" ", "<?php"],
			["-", "return $repository;"],
			["+", "return $workspace->reviewScope();"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Modules/Tender/Domain/Tender.php",
		type: "code",
		importance: "high",
		kind: "M",
		added: 5,
		removed: 2,
		lines: [
			[" ", "<?php"],
			["-", "return $this->deadline;"],
			["+", "return $this->submissionDeadline();"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Core/Review/panel.css",
		type: "code",
		importance: "low",
		kind: "M",
		added: 3,
		removed: 1,
		lines: [
			[" ", ".review-panel {"],
			["-", "  gap: 12px;"],
			["+", "  gap: 8px;"],
			[" ", "}"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Core/Review/panel.phtml",
		type: "code",
		importance: "low",
		kind: "M",
		added: 2,
		removed: 1,
		lines: [
			["-", "<h2>Changes</h2>"],
			["+", "<h2>Matching changes</h2>"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "src/Modules/Tender/Domain/Templates/panel.blade.php",
		type: "code",
		importance: "low",
		kind: "M",
		added: 2,
		removed: 1,
		lines: [
			["-", "<h2>{{ $tender->name }}</h2>"],
			["+", "<h2>{{ $tender->displayName() }}</h2>"],
		],
	},
	{
		repo: "BiCo",
		root: ".",
		codebase: "Web application",
		path: "library/vendor/example/Normalizer.php",
		type: "code",
		importance: "low",
		kind: "M",
		added: 2,
		removed: 1,
		lines: [
			[" ", "<?php"],
			["-", "return trim($value);"],
			["+", "return trim((string) $value);"],
		],
	},
	{
		repo: "Forge",
		root: "library/tools/forge",
		codebase: "Forge UI",
		path: "library/tools/forge/ui/src/review.css",
		type: "code",
		importance: "low",
		kind: "M",
		added: 2,
		removed: 1,
		lines: [
			[" ", ".review {"],
			["-", "  gap: 12px;"],
			["+", "  gap: 8px;"],
			[" ", "}"],
		],
	},
	{
		repo: "Forge",
		root: "library/tools/forge",
		codebase: "Forge server",
		path: "library/tools/forge/server/src/Core/ReviewPolicy.ts",
		type: "code",
		importance: "medium",
		kind: "M",
		added: 3,
		removed: 1,
		lines: [
			["-", "return changes;"],
			["+", "return review(changes);"],
		],
	},
	{
		repo: "Forge",
		root: "library/tools/forge",
		codebase: "Forge tooling",
		path: "library/tools/forge/library/vendor/example/Normalizer.ts",
		type: "code",
		importance: "medium",
		kind: "M",
		added: 2,
		removed: 1,
		lines: [
			["-", "return value.trim();"],
			["+", "return String(value).trim();"],
		],
	},
);

// A bounded 100-file design example, not a suggested review batch size.
window.forgeLargeFixtures = [...window.forgeFixtures];
const exampleModules = ["Tender", "Search", "Notifications", "Accounts", "Reports", "Subscriptions"];
for (let index = 0; window.forgeLargeFixtures.length < 100; index++) {
	const forge = index % 3 === 0;
	const moduleName = exampleModules[index % exampleModules.length];
	const type = ["code", "code", "tests", "doc", "config", "assets"][index % 6];
	const importance = type === "tests" ? "low" : "medium";
	const kind = ["M", "M", "A", "D", "R"][index % 5];
	const extension = { code: "tsx", tests: "test.tsx", doc: "md", config: "yaml", assets: "png" }[type];
	const filename = `${index % 7 === 0 ? "WorkspaceChangeNotificationPreferences" : `${moduleName}View`}${String(index + 1).padStart(2, "0")}.${extension}`;
	const folder = forge
		? `library/tools/forge/ui/src/Components/Review/${moduleName}/Details`
		: `src/Modules/${moduleName}/Components/Management/Preferences/Details`;
	window.forgeLargeFixtures.push({
		repo: forge ? "Forge" : "BiCo",
		root: forge ? "library/tools/forge" : ".",
		codebase: forge ? "Forge UI" : "Web application",
		path: `${folder}/${filename}`,
		type,
		importance,
		kind,
		...(kind === "R" ? { from: `${folder}/Previous${filename}` } : {}),
		added: kind === "D" || type === "assets" ? 0 : 4 + (index % 27),
		removed: kind === "A" || type === "assets" ? 0 : 1 + (index % 13),
		...(type === "assets"
			? { message: "Binary image file." }
			: {
					lines:
						kind === "D"
							? [["-", "// Previous example content"]]
							: kind === "A"
								? [["+", "// New example content"]]
								: [
										["-", "// Previous example content"],
										["+", "// Updated example content"],
									],
				}),
	});
}
