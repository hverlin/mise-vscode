import vscode from "vscode";
import {
	MISE_DOCTOR,
	MISE_INSTALL_ALL,
	MISE_LIST_ALL_TOOLS,
	MISE_MISSING_TOOLS_MENU,
	MISE_OPEN_EXTENSION_SETTINGS,
	MISE_OPEN_MENU,
	MISE_RELOAD,
	MISE_SELECT_WORKSPACE_FOLDER,
	MISE_SHOW_SETTINGS,
	MISE_SHOW_TRACKED_CONFIG,
} from "./commands";
import {
	disableExtensionForWorkspace,
	enableExtensionForWorkspace,
	isMiseExtensionEnabled,
} from "./configuration";
import type { MiseService } from "./miseService";
import { logger } from "./utils/logger";

export function createMenu(miseService: MiseService) {
	return vscode.commands.registerCommand(MISE_OPEN_MENU, async () => {
		const miseVersion = await miseService.getVersion();
		const pick = await vscode.window.showQuickPick(
			[
				{
					label: "Mise tools",
					detail: "List & manage Mise tools",
					iconPath: new vscode.ThemeIcon("tools"),
				},
				{
					label: "Mise settings",
					detail: "Configure Mise settings",
					iconPath: new vscode.ThemeIcon("gear"),
				},
				{
					label: "Tracked configurations",
					detail: "List & manage tracked configurations",
					iconPath: new vscode.ThemeIcon("list-selection"),
				},
				(vscode.workspace.workspaceFolders?.length ?? 0) > 1
					? {
							label: "Select workspace",
							detail: miseService.getCurrentWorkspaceFolderPath(),
						}
					: undefined,
				{ label: "", kind: vscode.QuickPickItemKind.Separator },
				{ label: "Mise version", detail: miseVersion },
				{
					iconPath: new vscode.ThemeIcon("refresh"),
					label: "Reload configuration",
				},
				{ label: "", kind: vscode.QuickPickItemKind.Separator },
				{
					iconPath: new vscode.ThemeIcon("gear"),
					label: "Open extension settings",
				},
				{
					iconPath: new vscode.ThemeIcon("output"),
					label: "Show logs",
				},
				{
					iconPath: new vscode.ThemeIcon("bug"),
					label: "Mise Doctor",
				},
				{
					iconPath: new vscode.ThemeIcon("info"),
					label: "About vscode-mise",
				},
				{ label: "", kind: vscode.QuickPickItemKind.Separator },
				isMiseExtensionEnabled()
					? { label: "Disable the mise extension for this workspace" }
					: {
							label: "Enable extension",
							detail: "Enable the mise extension for this workspace",
						},
			].filter((a) => a !== undefined) satisfies Array<vscode.QuickPickItem>,
			{ title: "Mise - Command menu" },
		);

		switch (pick?.label) {
			case "Mise tools":
				await vscode.commands.executeCommand(MISE_LIST_ALL_TOOLS);
				break;
			case "Mise settings":
				await vscode.commands.executeCommand(MISE_SHOW_SETTINGS);
				break;
			case "Tracked configurations":
				await vscode.commands.executeCommand(MISE_SHOW_TRACKED_CONFIG);
				break;
			case "Reload configuration":
				await vscode.commands.executeCommand(MISE_RELOAD);
				break;
			case "Select workspace":
				await vscode.commands.executeCommand(MISE_SELECT_WORKSPACE_FOLDER);
				break;
			case "Open extension settings":
				await vscode.commands.executeCommand(MISE_OPEN_EXTENSION_SETTINGS);
				break;
			case "About vscode-mise":
				vscode.env.openExternal(
					vscode.Uri.parse("https://github.com/hverlin/mise-vscode"),
				);
				break;
			case "Disable the mise extension for this workspace":
				await disableExtensionForWorkspace();
				break;
			case "Enable extension":
				await enableExtensionForWorkspace();
				break;
			case "Show logs":
				logger.show();
				break;
			case "Mise Doctor":
				await vscode.commands.executeCommand(MISE_DOCTOR);
				break;
			default:
				break;
		}
	});
}

export const createMissingToolsMenu = () =>
	vscode.commands.registerCommand(MISE_MISSING_TOOLS_MENU, async () => {
		const pick = await vscode.window.showQuickPick(
			[{ label: "Install all missing tools" }],
			{ title: "Mise - Missing tools" },
		);

		switch (pick?.label) {
			case "Install all missing tools":
				await vscode.commands.executeCommand(MISE_INSTALL_ALL);
				break;
			default:
				break;
		}
	});
