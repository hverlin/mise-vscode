import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { updateVSCodeSettings } from "../configuration";
import type { VSCodeSettingValue } from "../configuration";
import type { MiseService } from "../miseService";
import { isWindows } from "./fileUtils";
import { logger } from "./logger";
import type { ConfigurableExtension } from "./supportedExtensions";

export async function configureSimpleExtension(
	miseService: MiseService,
	{
		configKey,
		useShims,
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
		// shims on windows which only support `.exe`
		windowsShimOnlyEXE: boolean;
		// for some tools/extension on windows, the `.exe` ext might be optional
		// this can help extensions like `Deno` where `mise which` returns `deno.exe` on windows
		windowsExtOptional: boolean;
		// if using useSymLinks, a side effect is that a symlink will be created in the `.vscode` directory
		useSymLinks: boolean;
		tool: MiseTool;
		miseConfig: MiseConfig;
		binName: string;
	},
): Promise<string | undefined> {
	let pathToReturn = "";

	if (useShims) {
		let shimPath = path.join(miseConfig.dirs.shims, binName);
		if (isWindows) {
			const mode = (await miseService.getSetting("windows_shim_mode"))?.trim();
			if (mode === "file" && windowsShimOnlyEXE) {
				logger.error(
					`Extension tool ${binName} only support \`exe\` in windows, change mise setting \`windows_shim_mode\` to \`symlink\` or \`hardlink\``,
				);
				return undefined;
			}

			shimPath = shimPath + (mode === "file" ? ".cmd" : ".exe");
		}
		if (!existsSync(shimPath)) {
			return undefined;
		}
		pathToReturn = shimPath;
	} else {
		// let mise handle path
		// node https://github.com/jdx/mise/blob/67f5ea8317bcf26755ef6ff65ed460fa272db9ff/src/plugins/core/node.rs#L217-L223
		// python: windows: `python.exe` / linux: `bin/python` (https://github.com/jdx/mise/blob/67f5ea8317bcf26755ef6ff65ed460fa272db9ff/src/plugins/core/python.rs#L30-L36)
		// ruff: windows: `ruff.exe / linux: `ruff-x86_64-unknown-linux-musl/ruff`
		const binPath = await miseService.which(binName);
		if (binPath === undefined) {
			return undefined;
		}
		pathToReturn = binPath;
	}

	if (useSymLinks) {
		// some extension like `Deno` `Go` will add `.exe` to binName,
		// For example, it's not possible to use `deno` in that path name. One must specify `deno.exe`.
		// Shim name might end with `.cmd` (example: `node.cmd`), in this case, keep the `.cmd` suffix
		// (so keep ext same with target path)
		const ext = path.extname(pathToReturn);
		const symName = isWindows ? `${binName}${ext}` : binName;
		pathToReturn = await miseService.createMiseToolSymlink(
			symName,
			pathToReturn,
			"file",
		);
	}

	return isWindows && windowsExtOptional
		? pathToReturn.replace(/\.[^/\\.]+$/, "")
		: pathToReturn;
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
