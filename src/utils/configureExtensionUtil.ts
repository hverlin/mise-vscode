import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { updateVSCodeSettings } from "../configuration";
import type { VSCodeSettingValue } from "../configuration";
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
		// nodejs on windows default allow only `.exe`, no `.cmd`
		// https://github.com/jdx/mise/discussions/4360
		windowsShimOnlyEXE = true,
		windowsExtOptional = false,
		useSymLinks,
		tool,
		miseConfig,
		binName = tool.name,
		valueTransformer,
	}: {
		configKey: string;
		useShims: boolean;
		windowsShimOnlyEXE?: boolean;
		windowsExtOptional?: boolean;
		useSymLinks: boolean;
		tool: MiseTool;
		miseConfig: MiseConfig;
		binName?: string;
		valueTransformer?: (bin: string) => VSCodeSettingValue | undefined;
	},
) {
	const bin = await getConfiguredBinPath(miseService, {
		useShims,
		windowsShimOnlyEXE,
		windowsExtOptional,
		useSymLinks,
		tool,
		miseConfig,
		binName,
	});

	if (bin === undefined) {
		return {};
	}

	if (valueTransformer !== undefined) {
		return { [configKey]: valueTransformer(bin) };
	}

	return {
		[configKey]: bin,
	};
}

export async function getConfiguredBinPath(
	miseService: MiseService,
	{
		useShims,
		windowsShimOnlyEXE,
		windowsExtOptional,
		useSymLinks,
		tool,
		miseConfig,
		binName = tool.name,
	}: {
		useShims: boolean;
		// extension in windows, it only support `.exe`
		windowsShimOnlyEXE: boolean;
		// extension in windows, the `.exe` ext is optional
		// this help extension like `Deno` make no difference to linux/unix  in `settings.json`
		windowsExtOptional: boolean;

		useSymLinks: boolean;
		tool: MiseTool;
		miseConfig: MiseConfig;
		binName: string;
	},
): Promise<string | undefined> {
	let updatedPath = "";

	if (useShims) {
		let shimPath = path.join(miseConfig.dirs.shims, binName);
		if (isWindows) {
			const mode = (await miseService.getSetting("windows_shim_mode"))?.trim();
			if (mode === "file" && windowsShimOnlyEXE) {
				logger.error(
					`extension tool ${binName} only support \`exe\` in windows, change mise setting \`windows_shim_mode\` to \`symlink\` or \`hardlink\``,
				);
				return undefined;
			}

			shimPath = shimPath + (mode === "file" ? ".cmd" : ".exe");
		}
		if (!existsSync(shimPath)) {
			return undefined;
		}
		updatedPath = shimPath;
	} else {
		// let mise handle path
		// python:
		// 	 windows: `python.exe`
		//   linux: `bin/python`
		// ruff:
		//   windows: `ruff.exe`
		//   linux: `ruff-x86_64-unknown-linux-musl/ruff`
		const binPath = await miseService.which(binName);
		if (binPath === undefined) {
			return undefined;
		}
		updatedPath = binPath;
	}

	if (useSymLinks) {
		// some extension like `Deno` `Go` will add `.exe` to binName,
		// cannot use `deno`, must `deno.exe`.
		// shim name maybe `node.cmd`, keep `.cmd` suffix
		// so keep ext same with target path
		const ext = path.extname(updatedPath);
		const symName = isWindows ? `${binName}${ext}` : binName;
		updatedPath = await miseService.createMiseToolSymlink(
			symName,
			updatedPath,
			"file",
		);
	}

	if (isWindows && windowsExtOptional) {
		updatedPath = updatedPath.replace(/\.[^/\\.]+$/, "");
	}

	return updatedPath;
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
		Object.entries(extConfig)
			.map(([key, value]) => (value !== undefined ? { key, value } : undefined))
			.filter((x) => x !== undefined),
		ConfigurationTarget.Workspace,
	);

	if (updatedKeys.length === 0) {
		return { configurableExtension, updatedKeys: [] };
	}

	return { configurableExtension, updatedKeys };
}
