import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import { isMiseConfigPath } from "./miseUtilts";

const TOMBI_EXTENSION_ID = "tombi-toml.tombi";
const STRING_TOKENS_SETTING = "semanticTokens.strings.enabled";

// not the key of mise-vscode 1.31.0: it turned off the setting under its Tombi
// 1.8.10 name, `semanticTokens.strings.enable`, which Tombi 1.9.0 ignores
export const TOMBI_STRING_TOKENS_NOTIFICATION_SHOWN_KEY =
	"mise.tombiStringTokensEnabledNotificationShown";

/**
 * Tombi's semantic tokens for strings are drawn over the shell highlighting of
 * task scripts. Tombi 1.9.0 can stop sending them: this offers it once, the
 * first time a mise config file is opened while they are on.
 *
 * @returns whether the notification was shown
 */
export async function recommendTombiStringTokensOff(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
): Promise<boolean> {
	if (
		!isMiseExtensionEnabled() ||
		context.globalState.get<boolean>(
			TOMBI_STRING_TOKENS_NOTIFICATION_SHOWN_KEY,
		) ||
		!isMiseConfigPath(document.uri.fsPath) ||
		!vscode.extensions.getExtension(TOMBI_EXTENSION_ID)
	) {
		return false;
	}

	const tombiConfig = vscode.workspace.getConfiguration("tombi");
	// older versions of Tombi do not register the setting
	const isSettingSupported =
		tombiConfig.inspect<boolean>(STRING_TOKENS_SETTING)?.defaultValue !==
		undefined;
	// without semantic highlighting, nothing is drawn over the shell highlighting
	const isSemanticHighlightingOff =
		vscode.workspace
			.getConfiguration("editor", document)
			.get("semanticHighlighting.enabled") === false;
	if (
		!isSettingSupported ||
		tombiConfig.get<boolean>(STRING_TOKENS_SETTING) === false ||
		isSemanticHighlightingOff
	) {
		return false;
	}

	// before the dialog: a notification left open must not be shown again
	await context.globalState.update(
		TOMBI_STRING_TOKENS_NOTIFICATION_SHOWN_KEY,
		true,
	);

	const turnOff = "Turn Off";
	const selection = await vscode.window.showInformationMessage(
		"Tombi's semantic highlighting of strings hides the shell highlighting of mise task scripts. Turn it off? Strings keep their color.",
		turnOff,
	);
	if (selection === turnOff) {
		// Tombi asks to restart its language server when the setting changes
		await tombiConfig.update(
			STRING_TOKENS_SETTING,
			false,
			vscode.ConfigurationTarget.Global,
		);
	}
	return true;
}
