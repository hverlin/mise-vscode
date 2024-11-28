import vscode from "vscode";
import { MISE_OPEN_MENU, MISE_OPEN_SETTINGS, MISE_RELOAD } from "./commands";
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
				{ label: "Mise version", detail: miseVersion },
				{
					iconPath: new vscode.ThemeIcon("refresh"),
					label: "Reload configuration",
					detail: "Reload Mise configuration",
				},
				{ label: "", kind: vscode.QuickPickItemKind.Separator },
				{
					iconPath: new vscode.ThemeIcon("gear"),
					label: "Open extension settings",
				},
				{
					iconPath: new vscode.ThemeIcon("list-selection"),
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
			case "Reload configuration":
				await vscode.commands.executeCommand(MISE_RELOAD);
				break;
			case "Open extension settings":
				await vscode.commands.executeCommand(MISE_OPEN_SETTINGS);
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
