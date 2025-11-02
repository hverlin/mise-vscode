import * as vscode from "vscode";
import { logger } from "./utils/logger";

/**
 * Browser/web extension entry point.
 */
export async function activate(_context: vscode.ExtensionContext) {
    console.log('test')
    try {
		logger.info(
			"Mise extension activated successfully (browser mode) - syntax highlighting enabled"
		);
	} catch (error) {
		logger.error("Error while activating Mise extension (browser mode)", error);
		throw error;
	}
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: required by VSCode extension API
export function deactivate() {
	logger.info("Deactivating Mise extension (browser mode)");
}


