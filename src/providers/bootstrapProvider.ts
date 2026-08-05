import * as vscode from "vscode";
import {
	MISE_OPEN_BOOTSTRAP_ENTRY_DEFINITION,
	MISE_RUN_BOOTSTRAP,
	MISE_RUN_BOOTSTRAP_DRY_RUN,
	MISE_RUN_BOOTSTRAP_PLAN,
} from "../commands";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	bootstrapEntryKeyCandidates,
	findKeyInTomlDocument,
} from "../utils/bootstrapDocument";
import {
	BOOTSTRAP_NEUTRAL_STATES,
	BOOTSTRAP_OK_STATES,
	type BootstrapEntry,
	type BootstrapSection,
	findKeyInText,
	getBootstrapSections,
} from "../utils/bootstrapUtils";
import { expandPath } from "../utils/fileUtils";
import { logger } from "../utils/logger";

type TreeItem = BootstrapSectionItem | BootstrapEntryItem;

function entryStateIcon(state: string): vscode.ThemeIcon {
	if (BOOTSTRAP_OK_STATES.has(state)) {
		return new vscode.ThemeIcon("check");
	}
	if (BOOTSTRAP_NEUTRAL_STATES.has(state)) {
		return new vscode.ThemeIcon("circle-slash");
	}
	return new vscode.ThemeIcon("alert");
}

export class MiseBootstrapProvider
	implements vscode.TreeDataProvider<TreeItem>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		TreeItem | undefined | null | void
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private miseService: MiseService) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		if (!element) {
			try {
				const status = await this.miseService.getBootstrapStatus();
				if (!status) {
					return [];
				}

				return getBootstrapSections(status).map(
					(section) => new BootstrapSectionItem(section),
				);
			} catch (error) {
				logger.info("Failed to get bootstrap status", error);
				vscode.commands.executeCommand(
					"setContext",
					"mise.bootstrapProviderError",
					true,
				);
				return [];
			}
		}

		if (element instanceof BootstrapSectionItem) {
			return element.section.entries.map(
				(entry) => new BootstrapEntryItem(entry),
			);
		}

		return [];
	}
}

class BootstrapSectionItem extends vscode.TreeItem {
	constructor(public readonly section: BootstrapSection) {
		const pending = section.entries.filter(
			(entry) =>
				!BOOTSTRAP_OK_STATES.has(entry.state) &&
				!BOOTSTRAP_NEUTRAL_STATES.has(entry.state),
		).length;

		super(
			section.label,
			pending > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed,
		);

		this.contextValue = "miseBootstrapSection";
		this.description =
			pending > 0
				? `(${pending}/${section.entries.length} pending)`
				: `(${section.entries.length})`;
		this.iconPath = new vscode.ThemeIcon(pending > 0 ? "warning" : "pass");
	}
}

class BootstrapEntryItem extends vscode.TreeItem {
	constructor(entry: BootstrapEntry) {
		super(entry.label, vscode.TreeItemCollapsibleState.None);

		this.description = entry.description;
		this.tooltip = entry.tooltip;
		this.iconPath = entryStateIcon(entry.state);
		this.contextValue = "miseBootstrapEntry";

		this.command = {
			command: MISE_OPEN_BOOTSTRAP_ENTRY_DEFINITION,
			title: "Open Definition",
			arguments: [entry],
		};
	}
}

async function openBootstrapEntryDefinition(
	miseService: MiseService,
	entry: BootstrapEntry | undefined,
) {
	if (!entry?.definition) {
		return;
	}

	const configFilePaths = (await miseService.getMiseConfigFiles())
		.map((configFile) => expandPath(configFile.path))
		.filter((configFilePath) => configFilePath.endsWith(".toml"));

	const documents: vscode.TextDocument[] = [];
	for (const configFilePath of configFilePaths) {
		try {
			documents.push(
				await vscode.workspace.openTextDocument(
					vscode.Uri.file(configFilePath),
				),
			);
		} catch {
			// config file no longer exists
		}
	}

	const { tablePath, key } = entry.definition;
	// look for the exact key in all config files first, then alternate
	// declarations (e.g. the [bootstrap.macos.finder] shorthand of a macOS
	// default); only when nothing is found anywhere, fall back to the
	// enclosing table (e.g. the domain table of a macOS default)
	const keyCandidates = bootstrapEntryKeyCandidates(entry);
	const candidates = [...keyCandidates];
	if (tablePath.length > 0) {
		candidates.push({
			tablePath: tablePath.slice(0, -1),
			key: tablePath[tablePath.length - 1] as string,
		});
	}

	const showRange = async (
		document: vscode.TextDocument,
		range: vscode.Range,
	) => {
		const editor = await vscode.window.showTextDocument(document);
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
	};

	for (const candidate of candidates) {
		for (const document of documents) {
			const range = findKeyInTomlDocument(
				document,
				candidate.tablePath,
				candidate.key,
			);
			if (range) {
				return showRange(document, range);
			}
		}
	}

	// the structured lookup can miss (e.g. a config file the TOML parser does
	// not fully parse): fall back to a plain-text search for the keys
	const textSearchKeys = [
		...new Set(keyCandidates.map((candidate) => candidate.key)),
	];
	for (const searchKey of textSearchKeys) {
		for (const document of documents) {
			const match = findKeyInText(document.getText(), searchKey);
			if (match) {
				return showRange(
					document,
					new vscode.Range(
						new vscode.Position(match.line, match.character),
						new vscode.Position(match.line, match.character + match.length),
					),
				);
			}
		}
	}

	logger.info(
		`Could not find bootstrap entry "${entry.label}" (table: ${tablePath.join(".")}, key: ${key}) in: ${documents
			.map((document) => document.fileName)
			.join(", ")}`,
	);
	vscode.window.showInformationMessage(
		`Could not find where "${entry.label}" is declared`,
	);
}

export function registerBootstrapCommands(
	context: vscode.ExtensionContext,
	miseService: MiseService,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_RUN_BOOTSTRAP, async () => {
			const selection = await vscode.window.showWarningMessage(
				"Run mise bootstrap? This will install packages, clone repos, apply dotfiles, and converge the machine to the current configuration.",
				{ modal: true },
				"Yes",
				"dry run",
			);

			if (!selection) {
				return;
			}

			await miseService.runBootstrapInConsole({
				dryRun: selection === "dry run",
			});
		}),
		vscode.commands.registerCommand(MISE_RUN_BOOTSTRAP_DRY_RUN, async () => {
			await miseService.runBootstrapInConsole({ dryRun: true });
		}),
		vscode.commands.registerCommand(MISE_RUN_BOOTSTRAP_PLAN, async () => {
			if (!(await miseService.isBootstrapPlanAvailable())) {
				vscode.window.showWarningMessage(
					"`mise bootstrap plan` requires mise 2026.8.2 or later.",
				);
				return;
			}

			// only the sections that adopted mise's resource model are planned, so
			// a configuration made of the others plans nothing at all. Which ones
			// those are is mise's to say and keeps growing, so ask for the plan
			// instead of naming them here
			const plan = await miseService.getBootstrapPlan().catch(() => {
				// let the plan itself report whatever is wrong
				return undefined;
			});
			if (plan?.resources.length === 0) {
				const learnMore = "Learn more";
				const selection = await vscode.window.showInformationMessage(
					'Nothing to plan: no section of this configuration is covered by `mise bootstrap plan`. They still apply with "Run mise bootstrap".',
					learnMore,
				);
				if (selection === learnMore) {
					await vscode.env.openExternal(
						vscode.Uri.parse("https://mise.jdx.dev/bootstrap.html"),
					);
				}
				return;
			}

			await miseService.runBootstrapPlanInConsole();
		}),
		vscode.commands.registerCommand(
			MISE_OPEN_BOOTSTRAP_ENTRY_DEFINITION,
			async (entry: BootstrapEntry | undefined) => {
				await openBootstrapEntryDefinition(miseService, entry);
			},
		),
	);
}
