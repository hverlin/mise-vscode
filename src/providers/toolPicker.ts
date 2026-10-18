import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import {
	findRegistryMatches,
	getPackageRegistryQuery,
	getTypedTool,
	PACKAGE_REGISTRY_PREFIXES,
	withoutVersion,
} from "../utils/toolSearch";

/** wait for the user to stop typing before searching a package registry */
const SEARCH_DELAY_MS = 300;

type ToolPickItem = vscode.QuickPickItem & {
	/** what `mise use` gets, the label when unset */
	tool?: string;
	/** the item fills in a package registry prefix to search it */
	searchPrefix?: string;
};

/**
 * Asks for the tool to use: one of the registry, or one typed as
 * `backend:name`. For a package registry such as `npm:`, the registry tools
 * with that backend come first, then the packages `mise search` finds.
 * Resolves with the tool, or undefined when dismissed.
 */
export async function pickToolToUse(
	miseService: MiseService,
): Promise<string | undefined> {
	const [registry, canSearchPackages] = await Promise.all([
		miseService.miseRegistry(),
		miseService.supportsPackageRegistrySearch(),
	]);

	const registryItems: ToolPickItem[] = [
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
		? "Search for a tool (e.g. node), or type backend:name (e.g. npm:prettier, github:cli/cli)"
		: "Search for a tool (e.g. node), or type backend:name (e.g. github:cli/cli)";
	quickPick.matchOnDescription = true;
	quickPick.items = registryItems;

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	// only the results of the latest search are shown
	let searchId = 0;
	// setting the items sends them all to the window, ~1000 for the registry
	let showsRegistry = true;

	const onValue = (value: string) => {
		clearTimeout(searchTimer);
		const id = ++searchId;
		const typedTool = getTypedTool(value);
		if (!typedTool) {
			quickPick.busy = false;
			if (!showsRegistry) {
				quickPick.items = registryItems;
				showsRegistry = true;
			}
			return;
		}

		// None of the labels holds what was typed: the window sorts the items
		// whose label matches it, and keeps the others in this order.
		const matches = findRegistryMatches(registry, typedTool).map(
			({ short, backend }): ToolPickItem => ({
				label: short,
				description: backend,
				alwaysShow: true,
			}),
		);
		const showItems = (packages: ToolPickItem[]) => {
			const tools = [
				...matches.map((match) => match.description),
				...packages.map((item) => item.tool),
			];
			quickPick.items = [
				...matches,
				...packages,
				...(tools.includes(typedTool)
					? []
					: [
							{
								label: "$(edit) Use as typed",
								description: typedTool,
								tool: typedTool,
								alwaysShow: true,
							},
						]),
			];
			showsRegistry = false;
		};
		showItems([]);

		const query = canSearchPackages
			? getPackageRegistryQuery(withoutVersion(typedTool))
			: undefined;
		if (!query) {
			quickPick.busy = false;
			return;
		}

		quickPick.busy = true;
		searchTimer = setTimeout(async () => {
			let packages: ToolPickItem[] = [];
			try {
				const registryBackends = new Set(matches.map((m) => m.description));
				packages = (await miseService.searchTools(query))
					.filter((result) => !registryBackends.has(result.name))
					.map((result) => ({
						label: `$(package) ${result.name.slice(result.name.indexOf(":") + 1)}`,
						description: result.description,
						tool: result.name,
						alwaysShow: true,
					}));
			} catch (error) {
				logger.info(`Could not search for ${query}`, error as Error);
			}
			if (id === searchId) {
				quickPick.busy = false;
				showItems(packages);
			}
		}, SEARCH_DELAY_MS);
	};

	return new Promise((resolve) => {
		const disposables = [
			quickPick.onDidChangeValue(onValue),
			quickPick.onDidAccept(() => {
				const [selected] = quickPick.selectedItems;
				if (!selected) {
					return;
				}
				if (selected.searchPrefix) {
					quickPick.value = selected.searchPrefix;
					return;
				}
				resolve(selected.tool ?? selected.label);
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
