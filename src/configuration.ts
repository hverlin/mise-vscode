import { isDeepStrictEqual } from "node:util";
import { deepMerge } from "@std/collections";
import * as vscode from "vscode";
import { resolveConfiguredBinPath } from "./utils/fileUtils";
import { logger } from "./utils/logger";

export const CONFIGURATION_FLAGS = {
	enable: "enable",
	binPath: "binPath",
	miseEnv: "miseEnv",
	configureExtensionsAutomatically: "configureExtensionsAutomatically",
	configureExtensionsUseShims: "configureExtensionsUseShims",
	configureExtensionsUseSymLinks: "configureExtensionsUseSymLinks",
	configureExtensionsSymLinksFolder: "configureExtensionsSymLinksFolder",
	configureExtensionsIncludeGlobalTools:
		"configureExtensionsIncludeGlobalTools",
	configureExtensionsAutomaticallyIgnoreList:
		"configureExtensionsAutomaticallyIgnoreList",
	configureExtensionsAutomaticallyIncludeList:
		"configureExtensionsAutomaticallyIncludeList",
	enableCodeLens: "enableCodeLens",
	enableToolLinks: "enableToolLinks",
	showToolVersionsDecorations: "showToolVersionsDecorations",
	showToolEnvVarsDecorations: "showToolEnvVarsDecorations",
	showOutdatedToolGutterDecorations: "showOutdatedToolGutterDecorations",
	checkForNewMiseVersion: "checkForNewMiseVersion",
	keepReplacedVersionOnUpgrade: "keepReplacedVersionOnUpgrade",
	updateEnvAutomatically: "updateEnvAutomatically",
	updateEnvAutomaticallyIncludePath: "updateEnvAutomaticallyIncludePath",
	updateOpenTerminalsEnvAutomatically: "updateOpenTerminalsEnvAutomatically",
	teraAutoCompletion: "teraAutoCompletion",
	resolveMonorepoProjectConfigs: "resolveMonorepoProjectConfigs",
	automaticallyTrustMiseConfigFiles: "automaticallyTrustMiseConfigFiles",
	commandTTLCacheSeconds: "commandTTLCacheSeconds",
	showNotificationIfMissingTools: "showNotificationIfMissingTools",
	autoDetectMiseBinPath: "autoDetectMiseBinPath",
	customBinaryExtensions: "customBinaryExtensions",
	customFolderExtensions: "customFolderExtensions",
	enableTaskSymbolProvider: "enableTaskSymbolProvider",
	skipWorkspaceBinaryApproval: "skipWorkspaceBinaryApproval",
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
		["biomejs.biome", "oxc.oxc-vscode"],
	);
};

export const getIncludeList = (): string[] => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsAutomaticallyIncludeList,
		["all"],
	);
};

export const shouldConfigureExtensionsAutomatically = (): boolean => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsAutomatically,
		false,
	);
};

export const enableAutoConfiguration = async () => {
	return getExtensionConfig().update(
		CONFIGURATION_FLAGS.configureExtensionsAutomatically,
		true,
		vscode.ConfigurationTarget.Global,
	);
};

export const shouldUseShims = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.configureExtensionsUseShims, true);
};

export const shouldUseSymLinks = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsUseSymLinks,
		false,
	);
};

export const DEFAULT_SYMLINKS_FOLDER = ".vscode/mise-tools";

export const getConfiguredSymLinksFolder = (): string => {
	const folder = getExtensionConfig()
		.get<string>(CONFIGURATION_FLAGS.configureExtensionsSymLinksFolder)
		?.trim();

	return folder || DEFAULT_SYMLINKS_FOLDER;
};

export const shouldIncludeGlobalTools = (): boolean => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.configureExtensionsIncludeGlobalTools,
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
	const configuredPath = getExtensionConfig()
		.get<string>(CONFIGURATION_FLAGS.binPath)
		?.trim();

	if (!configuredPath) {
		return configuredPath;
	}

	return resolveConfiguredBinPath(
		configuredPath,
		vscode.workspace.workspaceFolders?.map((folder) => ({
			name: folder.name,
			fsPath: folder.uri.fsPath,
		})) ?? [],
	);
};

export type BinPathSource =
	| "workspaceFolder"
	| "workspace"
	| "global"
	| "default";

/**
 * Where `mise.binPath` is set. The setting is `window` scoped, so a repository
 * can ship it in its own `.vscode/settings.json`: telling the two apart is what
 * lets the user know whether they chose the binary or the project did.
 */
export const getBinPathSource = (): {
	source: BinPathSource;
	value: string | undefined;
} => {
	const inspection = getExtensionConfig().inspect<string>(
		CONFIGURATION_FLAGS.binPath,
	);

	if (inspection?.workspaceFolderValue !== undefined) {
		return {
			source: "workspaceFolder",
			value: inspection.workspaceFolderValue,
		};
	}
	if (inspection?.workspaceValue !== undefined) {
		return { source: "workspace", value: inspection.workspaceValue };
	}
	if (inspection?.globalValue !== undefined) {
		return { source: "global", value: inspection.globalValue };
	}
	return { source: "default", value: inspection?.defaultValue };
};

/**
 * Whether the approval prompt for a workspace mise binary is turned off. The
 * setting is machine scoped, so a repository cannot enable it for the user.
 */
export const shouldSkipWorkspaceBinaryApproval = (): boolean => {
	return getConfOrElse(CONFIGURATION_FLAGS.skipWorkspaceBinaryApproval, false);
};

/** Whether `mise.binPath` comes from settings committed to the project */
export const isBinPathSetByWorkspace = (): boolean => {
	const { source } = getBinPathSource();
	return source === "workspace" || source === "workspaceFolder";
};

export const updateBinPath = async (binPath: string) => {
	logger.info(`Updating bin path to: ${binPath}`);

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

export const isToolLinksEnabled = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.enableToolLinks, true);
};

export const shouldShowToolVersionsDecorations = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.showToolVersionsDecorations, true);
};

export const shouldShowToolEnvVarsDecorations = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.showToolEnvVarsDecorations, true);
};

export const shouldShowOutdatedToolGutterDecorations = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.showOutdatedToolGutterDecorations,
		true,
	);
};

export const shouldCheckForNewMiseVersion = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.checkForNewMiseVersion, true);
};

export const shouldKeepReplacedVersionOnUpgrade = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.keepReplacedVersionOnUpgrade, false);
};

export const shouldUpdateEnv = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.updateEnvAutomatically, true);
};

export const shouldUpdateEnvAutomaticallyIncludePATH = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.updateEnvAutomaticallyIncludePath,
		true,
	);
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

export const shouldShowNotificationIfMissingTools = () => {
	return getConfOrElse(
		CONFIGURATION_FLAGS.showNotificationIfMissingTools,
		true,
	);
};

export const isTeraAutoCompletionEnabled = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.teraAutoCompletion, true);
};

export const getCommandTTLCacheSeconds = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.commandTTLCacheSeconds, 2);
};

export const shouldAutoDetectMiseBinPath = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.autoDetectMiseBinPath, true);
};

export const isTaskSymbolProviderEnabled = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.enableTaskSymbolProvider, false);
};

export const shouldResolveMonorepoProjectConfigs = () => {
	return getConfOrElse(CONFIGURATION_FLAGS.resolveMonorepoProjectConfigs, true);
};

type VSCodeSettingSubdirs = {
	key: string;
	subdirs?: string[];
	asArray?: boolean;
};

type CustomBinaryExtensionConfig = {
	extensionId: string;
	toolSources: string[];
	vscodeSetting: VSCodeSettingSubdirs;
	binName?: string;
	supportsShims?: boolean;
	supportsSymlinks?: boolean;
};

type CustomFolderExtensionConfig = {
	extensionId: string;
	toolSources: string[];
	vscodeSetting: VSCodeSettingSubdirs;
	folderName: string;
	sourceSubdirs?: string[];
	supportsSymlinks?: boolean;
};

export const getCustomBinaryExtensions = (): CustomBinaryExtensionConfig[] => {
	return getConfOrElse(CONFIGURATION_FLAGS.customBinaryExtensions, []);
};

export const getCustomFolderExtensions = (): CustomFolderExtensionConfig[] => {
	return getConfOrElse(CONFIGURATION_FLAGS.customFolderExtensions, []);
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

export const getCurrentWorkspaceFolder = (context: vscode.ExtensionContext) => {
	const availableFolders = vscode.workspace.workspaceFolders;
	if (!availableFolders) {
		return;
	}

	const selectedWorkspaceFolder = context.workspaceState.get(
		"selectedWorkspaceFolder",
	);
	if (!selectedWorkspaceFolder) {
		return availableFolders[0];
	}

	const foundFolder = availableFolders.find(
		(folder) => folder.name === selectedWorkspaceFolder,
	);
	if (foundFolder) {
		return foundFolder;
	}
	return availableFolders[0];
};

export const getCurrentWorkspaceFolderPath = (
	context: vscode.ExtensionContext,
) => {
	return getCurrentWorkspaceFolder(context)?.uri.fsPath;
};
