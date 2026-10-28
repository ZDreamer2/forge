export interface ComparedChange {
	readonly path: string;
	readonly kind: "added" | "modified" | "deleted" | "renamed";
	readonly from?: string;
	readonly oldMode: string;
	readonly newMode: string;
	readonly statistics: { readonly added: number; readonly removed: number; readonly binary: boolean };
	readonly correction?: "addition" | "deletion";
}
