import { isDeepStrictEqual } from "node:util";
import { deepMerge } from "@std/collections";
import * as vscode from "vscode";

export const MISE_OPEN_FILE = "mise.openFile";

export const CONFIGURATION_FLAGS = {
	enable: "mise.enable",
	binPath: "mise.binPath",
	profile: "mise.profile",
	configureExtensionsAutomatically: "mise.configureExtensionsAutomatically",
	configureExtensionsUseShims: "mise.configureExtensionsUseShims",
	configureExtensionsUseSymLinks: "mise.configureExtensionsUseSymLinks",
	configureExtensionsAutomaticallyIgnoreList:
		"mise.configureExtensionsAutomaticallyIgnoreList",
};

export const isMiseExtensionEnabled = (): boolean => {
	return vscode.workspace.getConfiguration("mise").get("enable") ?? true;
};

export const getMiseProfile = (): string | undefined => {
	return vscode.workspace.getConfiguration("mise").get("profile");
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
