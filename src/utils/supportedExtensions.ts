import * as path from "node:path";
import type { VSCodeSettingValue } from "../configuration";
import {
	configureSimpleExtension,
	createMiseToolSymlink,
} from "./configureExtensionUtil";
import type { MiseConfig } from "./miseDoctorParser";

export type ConfigurableExtension = {
	extensionId: string;
	toolNames: string[];
	generateConfiguration: (
		tool: MiseTool,
		miseConfig: MiseConfig,
		{ useShims, useSymLinks }: { useShims: boolean; useSymLinks: boolean },
	) => Promise<Record<string, VSCodeSettingValue>>;
};

export const SUPPORTED_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionId: "ms-python.python",
		toolNames: ["python"],
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
		extensionId: "denoland.vscode-deno",
		toolNames: ["deno"],
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
		extensionId: "charliermarsh.ruff",
		toolNames: ["ruff"],
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
		extensionId: "golang.go",
		toolNames: ["go"],
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
		extensionId: "oven.bun-vscode",
		toolNames: ["bun"],
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
		extensionId: "oracle.oracle-java",
		toolNames: ["java"],
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
		extensionId: "timonwong.shellcheck",
		toolNames: ["shellcheck"],
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
		toolNames: ["node"],
		extensionId: "ms-vscode.js-debug",
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
	{
		toolNames: ["php", "vfox:version-fox/vfox-php"],
		extensionId: "vscode.php-language-features",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "php.validate.executablePath",
				binName: "php",
				useShims,
				useSymLinks: false, // does not work with symlinks
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["php", "vfox:version-fox/vfox-php"],
		extensionId: "xdebug.php-debug",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims, useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "php.debug.executablePath",
				binName: "php",
				useShims,
				useSymLinks: false, // does not work with symlinks
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["julia"],
		extensionId: "julialang.language-julia",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useSymLinks },
		) => {
			return configureSimpleExtension({
				configKey: "julia.executablePath",
				useShims: false, // does not work with shims
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["erlang"],
		extensionId: "pgourlain.erlang",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useSymLinks },
		) => {
			const pathToBin = path.join(tool.install_path, "bin");
			return {
				"erlang.erlangPath": useSymLinks
					? await createMiseToolSymlink("erlang", pathToBin)
					: pathToBin,
			};
		},
	},
	{
		toolNames: ["dart", "vfox:version-fox/vfox-dart"],
		extensionId: "Dart-Code.dart-code",
		generateConfiguration: async (tool: MiseTool) => {
			return {
				"dart.sdkPath": tool.install_path,
			};
		},
	},
];

export const CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME = new Map<
	string,
	ConfigurableExtension[]
>();

for (const extension of SUPPORTED_EXTENSIONS) {
	for (const toolName of extension.toolNames) {
		const extensions = CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(toolName) ?? [];
		extensions.push(extension);
		CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.set(toolName, extensions);
	}
}
