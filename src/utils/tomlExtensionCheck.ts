import * as vscode from "vscode";
import { logger } from "./logger";

const TOML_EXTENSIONS = {
	evenBetterToml: {
		id: "tamasfe.even-better-toml",
		name: "Even Better TOML",
		url: "https://marketplace.visualstudio.com/items?itemName=tamasfe.even-better-toml",
	},
	tombi: {
		id: "tombi-toml.tombi",
		name: "Tombi TOML",
		url: "https://marketplace.visualstudio.com/items?itemName=tombi-toml.tombi",
	},
} as const;

export function checkTomlExtensions(context: vscode.ExtensionContext): void {
	const hasBeenNotified = context.globalState.get<boolean>(
		"mise.tomlExtensionNotificationShown",
	);

	if (hasBeenNotified) {
		return;
	}

	const hasTomlExtension = Object.values(TOML_EXTENSIONS).some((ext) =>
		vscode.extensions.getExtension(ext.id),
	);

	if (!hasTomlExtension) {
		logger.info("No TOML extension detected, showing notification");

		vscode.window
			.showInformationMessage(
				"Mise extension works best with a TOML extension for syntax highlighting and autocompletion. Either of the following are recommended:",
				"Tombi TOML",
				"Even Better TOML",
				"Don't Show Again",
			)
			.then((selection) => {
				if (selection === "Even Better TOML") {
					void vscode.env.openExternal(
						vscode.Uri.parse(TOML_EXTENSIONS.evenBetterToml.url),
					);
				} else if (selection === "Tombi TOML") {
					void vscode.env.openExternal(
						vscode.Uri.parse(TOML_EXTENSIONS.tombi.url),
					);
				} else if (selection === "Don't Show Again") {
					context.globalState.update(
						"mise.tomlExtensionNotificationShown",
						true,
					);
				}
			});
	}
}
