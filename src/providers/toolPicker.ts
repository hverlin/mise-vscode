import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import {
	getPackageRegistryQuery,
	PACKAGE_REGISTRY_PREFIXES,
} from "../utils/toolSearch";

export const CUSTOM_TOOL = "custom";

/** wait for the user to stop typing before searching a package registry */
const SEARCH_DELAY_MS = 300;

type ToolPickItem = vscode.QuickPickItem & {
	/** the item fills in a package registry prefix to search it */
	searchPrefix?: string;
};

/**
 * Asks for the tool to use: one of the registry, or, typed after a prefix
 * such as `npm:`, a package of that registry (`mise search`). Resolves with
 * the tool, `CUSTOM_TOOL` to enter one, or undefined when dismissed.
 */
export async function pickToolToUse(
	miseService: MiseService,
): Promise<string | undefined> {
	const [registry, canSearchPackages] = await Promise.all([
		miseService.miseRegistry(),
		miseService.supportsPackageRegistrySearch(),
	]);

	const registryItems: ToolPickItem[] = [
		{ label: CUSTOM_TOOL, description: "Enter a custom tool name" },
		...(canSearchPackages
			? PACKAGE_REGISTRY_PREFIXES.map(({ prefix, registry }) => ({
					label: prefix,
					description: `Search ${registry} packages`,
					searchPrefix: prefix,
				}))
			: []),
		...registry.map((tool) => ({ label: tool.short, description: tool.full })),
	];

	const quickPick = vscode.window.createQuickPick<ToolPickItem>();
	quickPick.placeholder = canSearchPackages
		? "Search for a tool to install (e.g. node, or npm:prettier)"
		: "Search for a tool to install (e.g. node)";
	quickPick.matchOnDescription = true;
	quickPick.items = registryItems;

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	// only the results of the latest search are shown
	let searchId = 0;
	// setting the items sends them all to the window, ~1000 for the registry
	let showsRegistry = true;

	const search = (value: string) => {
		clearTimeout(searchTimer);
		const id = ++searchId;
		const query = canSearchPackages
			? getPackageRegistryQuery(value)
			: undefined;
		if (!query) {
			quickPick.busy = false;
			if (!showsRegistry) {
				quickPick.items = registryItems;
				showsRegistry = true;
			}
			return;
		}

		quickPick.busy = true;
		searchTimer = setTimeout(async () => {
			let results: ToolPickItem[] = [];
			try {
				results = (await miseService.searchTools(query)).map((result) => ({
					label: result.name,
					description: result.description,
					// already matched by mise, which also matches the description
					alwaysShow: true,
				}));
			} catch (error) {
				logger.info(`Could not search for ${query}`, error as Error);
			}
			if (id === searchId) {
				quickPick.busy = false;
				// e.g. a private package, or offline: the name typed can still be used
				quickPick.items = results.length
					? results
					: [{ label: query, description: "Use this name", alwaysShow: true }];
				showsRegistry = false;
			}
		}, SEARCH_DELAY_MS);
	};

	return new Promise((resolve) => {
		const disposables = [
			quickPick.onDidChangeValue(search),
			quickPick.onDidAccept(() => {
				const [selected] = quickPick.selectedItems;
				// the items shown are the results for what was typed before
				if (!selected || quickPick.busy) {
					return;
				}
				if (selected.searchPrefix) {
					quickPick.value = selected.searchPrefix;
					return;
				}
				resolve(selected.label);
				quickPick.hide();
			}),
			quickPick.onDidHide(() => {
				clearTimeout(searchTimer);
				searchId++;
				resolve(undefined);
				for (const disposable of disposables) {
					disposable.dispose();
				}
				quickPick.dispose();
			}),
		];
		quickPick.show();
	});
}
