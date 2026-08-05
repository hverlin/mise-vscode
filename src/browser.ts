import * as vscode from "vscode";
import { MiseTomlTaskSymbolProvider } from "./providers/MiseTomlTaskSymbolProvider";
import { MiseSnippetProvider } from "./providers/miseSnippetProvider";
import { logger } from "./utils/logger";

/**
 * The settings are read directly here: `configuration.ts` reaches for node-only
 * helpers, which the web bundle cannot pull in.
 */
const isEnabled = (flag: string) =>
	vscode.workspace.getConfiguration("mise").get<boolean>(flag) ?? true;

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

		// no mise binary on the web: the files are recognised by their name only
		const snippetProvider = new MiseSnippetProvider({
			isEnabled: () => isEnabled("enable") && isEnabled("enableSnippets"),
		});

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				{ language: "toml" },
				snippetProvider,
			),
			vscode.languages.registerCompletionItemProvider(
				{ language: "shellscript" },
				snippetProvider,
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
