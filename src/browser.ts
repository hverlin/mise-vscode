import * as vscode from "vscode";
import { MiseTomlTaskSymbolProvider } from "./providers/MiseTomlTaskSymbolProvider";
import { logger } from "./utils/logger";

/**
 * Browser/web extension entry point.
 */
export async function activate(context: vscode.ExtensionContext) {
	try {
		logger.info(
			"Mise extension activated successfully (browser mode) - syntax highlighting enabled",
		);

		context.subscriptions.push(
			vscode.languages.registerDocumentSymbolProvider(
				{ language: "toml" },
				new MiseTomlTaskSymbolProvider(vscode),
			),
		);
	} catch (error) {
		logger.error("Error while activating Mise extension (browser mode)", error);
		throw error;
	}
}

export function deactivate() {
	logger.info("Deactivating Mise extension (browser mode)");
}
