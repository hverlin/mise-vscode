import * as path from "node:path";
import type { VSCodeSettingValue } from "../configuration";
import {
	configureSimpleExtension,
	createMiseToolSymlink,
} from "./configureExtensionUtil";
import type { MiseConfig } from "./miseDoctorParser";

export type ConfigurableExtension = {
	extensionName: string;
	toolName: string;
	generateConfiguration: (
		tool: MiseTool,
		miseConfig: MiseConfig,
		{ useShims, useSymLinks }: { useShims: boolean; useSymLinks: boolean },
	) => Promise<Record<string, VSCodeSettingValue>>;
};

export const SUPPORTED_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionName: "ms-python.python",
		toolName: "python",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "python.defaultInterpreterPath",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		extensionName: "denoland.vscode-deno",
		toolName: "deno",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "deno.path",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		extensionName: "charliermarsh.ruff",
		toolName: "ruff",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			const interpreterPath = useShims
				? path.join(miseConfig.dirs.shims, tool.name)
				: path.join(tool.install_path, "bin", tool.name);

			const configuredPath = useSymLinks
				? await createMiseToolSymlink(tool.name, interpreterPath)
				: interpreterPath;

			return {
				"ruff.path": [configuredPath],
			};
		},
	},
	{
		extensionName: "golang.go",
		toolName: "go",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			const goRoot = useSymLinks
				? await createMiseToolSymlink("goRoot", tool.install_path)
				: tool.install_path;

			const goBin = useShims
				? useSymLinks
					? await createMiseToolSymlink(
							"go",
							path.join(miseConfig.dirs.shims, "go"),
						)
					: path.join(miseConfig.dirs.shims, "go")
				: path.join(tool.install_path, "bin", "go");

			const dlvBin = useShims
				? useSymLinks
					? await createMiseToolSymlink(
							"dlv",
							path.join(miseConfig.dirs.shims, "dlv"),
						)
					: path.join(miseConfig.dirs.shims, "dlv")
				: path.join(tool.install_path, "bin", "dlv");

			return {
				"go.goroot": goRoot,
				"go.alternateTools": {
					go: goBin,
					dlv: dlvBin,
				},
			};
		},
	},
	{
		extensionName: "oven.bun-vscode",
		toolName: "bun",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "bun.runtime",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		extensionName: "oracle.oracle-java",
		toolName: "java",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig,
			{ useSymLinks },
		) => {
			return {
				"jdk.jdkhome": useSymLinks
					? await createMiseToolSymlink("java", tool.install_path)
					: tool.install_path,
			};
		},
	},
	{
		extensionName: "timonwong.shellcheck",
		toolName: "shellcheck",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "shellcheck.executablePath",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolName: "node",
		extensionName: "ms-vscode.js-debug",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			const interpreterPath = useShims
				? path.join(miseConfig.dirs.shims, tool.name)
				: path.join(tool.install_path, "bin", tool.name);

			const configuredPath = useSymLinks
				? await createMiseToolSymlink(tool.name, interpreterPath)
				: interpreterPath;

			return {
				"debug.javascript.defaultRuntimeExecutable": {
					"pwa-node": configuredPath,
				},
			};
		},
	},
];
