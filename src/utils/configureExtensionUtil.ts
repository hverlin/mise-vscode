import { existsSync } from "node:fs";
import { readlink, rm, symlink } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { updateVSCodeSettings } from "../configuration";
import { mkdirp } from "./fileUtils";
import { logger } from "./logger";
import type { MiseConfig } from "./miseDoctorParser";
import {
	type ConfigurableExtension,
	SUPPORTED_EXTENSIONS,
} from "./supportedExtensions";

export const CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME = new Map(
	SUPPORTED_EXTENSIONS.map((item) => [item.toolName, item]),
);

export async function createMiseToolSymlink(binName: string, binPath: string) {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const toolsPaths = path.join(
		folder?.uri.fsPath ?? "",
		".vscode",
		"mise-tools",
	);

	await mkdirp(toolsPaths);
	const linkPath = path.join(toolsPaths, binName);
	const configuredPath = path.join("${workspaceFolder}", toolsPaths, binName);

	if (existsSync(linkPath)) {
		logger.info(`${await readlink(linkPath)}: ${binPath}`);
		if ((await readlink(linkPath)) === binPath) {
			return configuredPath;
		}

		logger.info(
			`mise-tools/${binPath} was symlinked to a different version. Deleting the old symlink now.`,
		);
		await rm(linkPath);
	}

	await symlink(`${binPath}`, `${linkPath}`, "dir");
	logger.info(`New symlink created ${linkPath} -> ${binPath}`);
	return configuredPath;
}

export async function configureSimpleExtension({
	configKey,
	useShims,
	useSymLinks,
	tool,
	miseConfig,
}: {
	configKey: string;
	useShims: boolean;
	useSymLinks: boolean;
	tool: MiseTool;
	miseConfig: MiseConfig;
}) {
	const updatedValue = useShims
		? path.join(miseConfig.dirs.shims, tool.name)
		: path.join(tool.install_path, "bin", tool.name);

	const configuredPath = useSymLinks
		? await createMiseToolSymlink(tool.name, updatedValue)
		: updatedValue;

	return {
		[configKey]: configuredPath,
	};
}

export async function configureExtension({
	tool,
	miseConfig,
	configurableExtension,
	useShims = true,
	useSymLinks = false,
}: {
	tool: MiseTool;
	miseConfig: MiseConfig;
	configurableExtension: ConfigurableExtension;
	useShims?: boolean;
	useSymLinks?: boolean;
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

	const extConfig = await configurableExtension.generateConfiguration(
		tool,
		miseConfig,
		{ useShims, useSymLinks },
	);

	const updatedKeys = await updateVSCodeSettings(
		Object.entries(extConfig).map(([key, value]) => ({
			key,
			value,
		})),
		ConfigurationTarget.Workspace,
	);

	if (updatedKeys.length === 0) {
		return;
	}
	vscode.window
		.showInformationMessage(
			`Mise: Extension ${configurableExtension.extensionName} configured.\n${updatedKeys.join("\n")}`,
			"Show settings",
		)
		.then((selection) => {
			if (selection === "Show settings") {
				vscode.commands.executeCommand(
					"workbench.action.openWorkspaceSettingsFile",
				);
			}
		});
}
