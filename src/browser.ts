import type * as vscode from "vscode";
import { logger } from "./utils/logger";

/**
 * Browser/web extension entry point.
 */
export async function activate(_context: vscode.ExtensionContext) {
	try {
		logger.info(
			"Mise extension activated successfully (browser mode) - syntax highlighting enabled",
		);
	} catch (error) {
		logger.error("Error while activating Mise extension (browser mode)", error);
		throw error;
	}
}

export function deactivate() {
	logger.info("Deactivating Mise extension (browser mode)");
}
