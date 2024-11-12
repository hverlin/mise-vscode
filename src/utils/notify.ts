import * as vscode from "vscode";

type Created = { type?: "info" | "error"; settingsKey?: string };

export async function showSettingsNotification(
	message: string,
	{ type = "info", settingsKey = "mise." }: Created = {},
) {
	const notifyFn =
		type === "error"
			? vscode.window.showErrorMessage
			: vscode.window.showInformationMessage;

	const action = "Configure";
	const selection = await notifyFn(message, action);
	if (selection === action) {
		vscode.commands.executeCommand(
			"workbench.action.openSettings",
			settingsKey,
		);
	}
}
