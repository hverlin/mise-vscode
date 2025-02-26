import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { updateVSCodeSettings } from "../configuration";
import type { MiseService } from "../miseService";
import { isWindows } from "./fileUtils";
import { logger } from "./logger";
import type { MiseConfig } from "./miseDoctorParser";
import type { ConfigurableExtension } from "./supportedExtensions";

export async function configureSimpleExtension(
	miseService: MiseService,
	{
		configKey,
		useShims,
		useSymLinks,
		tool,
		miseConfig,
		binName = tool.name,
		windowsPath,
	}: {
		configKey: string;
		useShims: boolean;
		useSymLinks: boolean;
		tool: MiseTool;
		miseConfig: MiseConfig;
		binName?: string;
		windowsPath?: string;
	},
) {
	const updatedValue = useShims
		? path.join(miseConfig.dirs.shims, isWindows ? `${binName}.cmd` : binName)
		: path.join(
				tool.install_path,
				isWindows
					? windowsPath
						? windowsPath
						: path.join("bin", `${binName}.exe`)
					: path.join("bin", binName),
			);

	const configuredPath = useSymLinks
		? await miseService.createMiseToolSymlink(binName, updatedValue)
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
		return { configurableExtension, updatedKeys: [] };
	}

	if (!vscode.workspace.workspaceFolders?.length) {
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
