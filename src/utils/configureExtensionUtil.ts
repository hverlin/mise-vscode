import { existsSync } from "node:fs";
import { readlink, rm, symlink } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import {
	getRootFolder,
	getRootFolderPath,
	updateVSCodeSettings,
} from "../configuration";
import type { MiseService } from "../miseService";
import { mkdirp } from "./fileUtils";
import { logger } from "./logger";
import type { MiseConfig } from "./miseDoctorParser";
import type { ConfigurableExtension } from "./supportedExtensions";

export async function createMiseToolSymlink(binName: string, binPath: string) {
	const toolsPaths = path.join(
		getRootFolderPath() ?? "",
		".vscode",
		"mise-tools",
	);

	const sanitizedBinName = binName.replace(/[^a-zA-Z0-9]/g, "_");

	await mkdirp(toolsPaths);
	const linkPath = path.join(toolsPaths, sanitizedBinName);
	const configuredPath = path.join(
		"${workspaceFolder}",
		".vscode",
		"mise-tools",
		sanitizedBinName,
	);

	if (existsSync(linkPath)) {
		logger.debug(
			`Checking symlink for ${binName}: ${await readlink(linkPath)}: ${binPath}`,
		);
		if ((await readlink(linkPath)) === binPath) {
			return configuredPath;
		}

		logger.info(
			`mise-tools/${binPath} was symlinked to a different version. Deleting the old symlink now.`,
		);
		await rm(linkPath);
	}

	await symlink(binPath, linkPath, "dir").catch((err) => {
		if (err.code === "EEXIST") {
			logger.info("Symlink already exists for ${binPath}");
			return;
		}

		throw err;
	});
	logger.info(`New symlink created ${linkPath} -> ${binPath}`);
	return configuredPath;
}

export async function configureSimpleExtension({
	configKey,
	useShims,
	useSymLinks,
	tool,
	miseConfig,
	binName = tool.name,
}: {
	configKey: string;
	useShims: boolean;
	useSymLinks: boolean;
	tool: MiseTool;
	miseConfig: MiseConfig;
	binName?: string;
}) {
	const updatedValue = useShims
		? path.join(miseConfig.dirs.shims, binName)
		: path.join(tool.install_path, "bin", binName);

	const configuredPath = useSymLinks
		? await createMiseToolSymlink(binName, updatedValue)
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
	miseService,
}: {
	tool: MiseTool;
	miseConfig: MiseConfig;
	miseService: MiseService;
	configurableExtension: ConfigurableExtension;
	useShims?: boolean;
	useSymLinks?: boolean;
}) {
	const extension = vscode.extensions.getExtension(
		configurableExtension.extensionId,
	);
	if (!extension) {
		logger.error(
			`Mise: Extension ${configurableExtension.extensionId} is not installed`,
		);
		return { configurableExtension, updatedKeys: [] };
	}

	if (!getRootFolder()) {
		logger.info(
			`No workspace folders found, skipping extension configuration for: ${configurableExtension.extensionId}`,
		);
		return { configurableExtension, updatedKeys: [] };
	}

	const extConfig = await configurableExtension.generateConfiguration({
		tool,
		miseService,
		miseConfig,
		useShims,
		useSymLinks,
	});

	const updatedKeys = await updateVSCodeSettings(
		Object.entries(extConfig).map(([key, value]) => ({
			key,
			value,
		})),
		ConfigurationTarget.Workspace,
	);

	if (updatedKeys.length === 0) {
		return { configurableExtension, updatedKeys: [] };
	}

	return { configurableExtension, updatedKeys };
}
