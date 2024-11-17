import vscode from "vscode";
import { isMiseExtensionEnabled } from "./configuration";
import type { MiseService } from "./miseService";

export function createMenu(miseService: MiseService) {
	return vscode.commands.registerCommand("mise.openMenu", async () => {
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
					label: "Open Mise settings",
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
						| "Open Mise settings"
						| "About vscode-mise"
						| "Disable the mise extension for this workspace"
						| "Enable extension"
						| "Install missing tools"
						| "Install all tools"
						| "";
				}
			>,
			{ title: "Mise - Command menu" },
		);

		switch (pick?.label) {
			case "Reload configuration":
				await vscode.commands.executeCommand("mise.refreshEntry");
				break;
			case "Open Mise settings":
				await vscode.commands.executeCommand("mise.openSettings");
				break;
			case "About vscode-mise":
				vscode.env.openExternal(
					vscode.Uri.parse("https://github.com/hverlin/mise-vscode"),
				);
				break;
			case "Disable the mise extension for this workspace":
				await vscode.workspace
					.getConfiguration("mise")
					.update("enable", false, vscode.ConfigurationTarget.Workspace);
				break;
			case "Enable extension":
				await vscode.workspace
					.getConfiguration("mise")
					.update("enable", true, vscode.ConfigurationTarget.Workspace);
				break;
			default:
				break;
		}
	});
}
