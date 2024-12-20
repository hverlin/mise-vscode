import { isDeepStrictEqual } from "node:util";
import { deepMerge } from "@std/collections";
import * as vscode from "vscode";

export const CONFIGURATION_FLAGS = {
	enable: "enable",
	binPath: "binPath",
	miseEnv: "miseEnv",
	configureExtensionsAutomatically: "configureExtensionsAutomatically",
	configureExtensionsUseShims: "configureExtensionsUseShims",
	configureExtensionsUseSymLinks: "configureExtensionsUseSymLinks",
	configureExtensionsAutomaticallyIgnoreList:
		"configureExtensionsAutomaticallyIgnoreList",
	enableCodeLens: "enableCodeLens",
	showToolVersionsDecorations: "showToolVersionsDecorations",
	checkForNewMiseVersion: "checkForNewMiseVersion",
	updateEnvAutomatically: "updateEnvAutomatically",
	updateOpenTerminalsEnvAutomatically: "updateOpenTerminalsEnvAutomatically",
	teraAutoCompletion: "teraAutoCompletion",
	automaticallyTrustMiseConfigFiles: "automaticallyTrustMiseConfigFiles",
	commandTTLCacheSeconds: "commandTTLCacheSeconds",
} as const;

const getExtensionConfig = () => {
	return vscode.workspace.getConfiguration("mise");
};

export const getConfOrElse = <T>(
	key: (typeof CONFIGURATION_FLAGS)[keyof typeof CONFIGURATION_FLAGS],
	fallback: T,
): T => {
	return getExtensionConfig().get(key) ?? fallback;
};

export const getIgnoreList = (): string[] => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsAutomaticallyIgnoreList,
		[],
	);
};

export const shouldConfigureExtensionsAutomatically = (): boolean => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsAutomatically,
		true,
	);
};

export const shouldUseShims = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.configureExtensionsUseShims, true);
};

export const shouldUseSymLinks = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsUseSymLinks,
		true,
	);
};

export const isMiseExtensionEnabled = (): boolean => {
	return getConfOrElse(CONFIGURATION_FLAGS.enable, true);
};

export const getMiseEnv = (): string | undefined => {
	return getExtensionConfig().get<string>(CONFIGURATION_FLAGS.miseEnv);
};

export const getConfiguredBinPath = (): string | undefined => {
	return getExtensionConfig().get<string>(CONFIGURATION_FLAGS.binPath)?.trim();
};

export const updateBinPath = async (binPath: string) => {
	await getExtensionConfig().update(
		CONFIGURATION_FLAGS.binPath,
		binPath,
		vscode.ConfigurationTarget.Global,
	);
};

export const disableExtensionForWorkspace = async () => {
	return getExtensionConfig().update(
		"enable",
		false,
		vscode.ConfigurationTarget.Workspace,
	);
};

export const enableExtensionForWorkspace = async () => {
	return getExtensionConfig().update(
		"enable",
		true,
		vscode.ConfigurationTarget.Workspace,
	);
};

export const isCodeLensEnabled = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.enableCodeLens, true);
};

export const shouldShowToolVersionsDecorations = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.showToolVersionsDecorations, true);
};

export const shouldCheckForNewMiseVersion = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.checkForNewMiseVersion, true);
};

export const shouldUpdateEnv = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.updateEnvAutomatically, true);
};

export const shouldAutomaticallyReloadTerminalEnv = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.updateOpenTerminalsEnvAutomatically,
		false,
	);
};

export const shouldAutomaticallyTrustMiseConfigFiles = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.automaticallyTrustMiseConfigFiles,
		true,
	);
};

export const isTeraAutoCompletionEnabled = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.teraAutoCompletion, false);
};

export const getCommandTTLCacheSeconds = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.commandTTLCacheSeconds, 1);
};

export type VSCodeSettingValue =
	| string
	| number
	| boolean
	| Array<string | number | boolean>
	| Record<string, string | number | boolean>;

export type VSCodeSetting = {
	key: string;
	value: VSCodeSettingValue;
};

const isObject = (value: unknown) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export async function updateVSCodeSettings(
	newSettings: VSCodeSetting[],
	target: vscode.ConfigurationTarget,
): Promise<string[]> {
	const updatedKeys: string[] = [];
	const configuration = vscode.workspace.getConfiguration();

	for (const newSetting of newSettings) {
		const currentValue = configuration.get(newSetting.key);

		if (isDeepStrictEqual(currentValue, newSetting.value)) {
			continue;
		}

		if (isObject(newSetting.value) && isObject(currentValue)) {
			const mergedValue = deepMerge(
				currentValue as Record<string, unknown>,
				newSetting.value as Record<string, unknown>,
			);
			if (isDeepStrictEqual(currentValue, mergedValue)) {
				continue;
			}

			updatedKeys.push(newSetting.key);
			await configuration.update(newSetting.key, mergedValue, target);
		} else {
			updatedKeys.push(newSetting.key);
			await configuration.update(newSetting.key, newSetting.value, target);
		}
	}
	return updatedKeys;
}

export const getRootFolder = () => {
	return vscode.workspace.workspaceFolders?.[0];
};

export const getRootFolderPath = () => {
	return getRootFolder()?.uri.fsPath;
};
