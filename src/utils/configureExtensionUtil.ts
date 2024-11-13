import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { logger } from "./logger";
import type { MiseConfig } from "./miseDoctorParser";
import {
	type ConfigurableExtension,
	SUPPORTED_EXTENSIONS,
} from "./supportedExtensions";

export const CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME = new Map(
	SUPPORTED_EXTENSIONS.map((item) => [item.toolName, item]),
);

export async function configureExtension({
	tool,
	miseConfig,
	configurableExtension,
	useShims = true,
}: {
	tool: MiseTool;
	miseConfig: MiseConfig;
	configurableExtension: ConfigurableExtension;
	useShims?: boolean;
}) {
	const extension = vscode.extensions.getExtension(
		configurableExtension.extensionName,
	);
	if (!extension) {
		logger.error(
			`Mise: Extension ${configurableExtension.extensionName} is not installed`,
		);
		return;
	}

	if (
		vscode.workspace.workspaceFolders === undefined ||
		vscode.workspace.workspaceFolders.length === 0
	) {
		logger.info(
			`No workspace folders found, skipping extension configuration for: ${configurableExtension.extensionName}`,
		);
		return;
	}

	const configuration = vscode.workspace.getConfiguration();
	const extConfig = await configurableExtension.generateConfiguration(
		tool,
		miseConfig,
		{ useShims },
	);

	const updatedKeys: string[] = [];
	for (const [configKey, configValue] of Object.entries(extConfig)) {
		const previousConfigValue = configuration.get(configKey);
		const updatedValueStringified = JSON.stringify(configValue);
		if (JSON.stringify(previousConfigValue) === updatedValueStringified) {
			continue;
		}

		await configuration.update(
			configKey,
			configValue,
			ConfigurationTarget.Workspace,
		);
		updatedKeys.push(`${configKey}: ${updatedValueStringified}`);
	}

	if (updatedKeys.length === 0) {
		return;
	}
	vscode.window.showInformationMessage(
		`Mise: Extension ${configurableExtension.extensionName} configured.\n${updatedKeys.join("\n")}`,
	);
}
