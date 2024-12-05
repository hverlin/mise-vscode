import vscode from "vscode";
import {
	MISE_LIST_ALL_TOOLS,
	MISE_OPEN_EXTENSION_SETTINGS,
	MISE_OPEN_MENU,
	MISE_RELOAD,
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
			] satisfies Array<
				vscode.QuickPickItem & {
					label:
						| "Mise tools"
						| "Mise settings"
						| "Tracked configurations"
						| "Mise version"
						| "Reload configuration"
						| "Open extension settings"
						| "About vscode-mise"
						| "Disable the mise extension for this workspace"
						| "Enable extension"
						| "Install missing tools"
						| "Install all tools"
						| "Show logs"
						| "";
				}
			>,
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
			default:
				break;
		}
	});
}
