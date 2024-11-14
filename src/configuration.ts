import * as vscode from "vscode";

export const CONFIGURATION_FLAGS = {
	enable: "mise.enable",
	binPath: "mise.binPath",
	profile: "mise.profile",
	configureExtensionsAutomatically: "mise.configureExtensionsAutomatically",
	configureExtensionsUseShims: "mise.configureExtensionsUseShims",
};

export const isMiseExtensionEnabled = (): boolean => {
	return vscode.workspace.getConfiguration("mise").get("enable") ?? true;
};

export const getMiseProfile = (): string | undefined => {
	return vscode.workspace.getConfiguration("mise").get("profile");
};
