import * as path from "node:path";
import type { VSCodeSettingValue } from "../configuration";
import type { MiseService } from "../miseService";
import { configureSimpleExtension } from "./configureExtensionUtil";
import type { MiseConfig } from "./miseDoctorParser";

type GenerateConfigProps = {
	tool: MiseTool;
	miseService: MiseService;
	miseConfig: MiseConfig;
	useShims: boolean;
	useSymLinks: boolean;
};

export type ConfigurableExtension = {
	extensionId: string;
	toolNames: string[];
	generateConfiguration: ({
		tool,
		miseConfig,
		useShims,
		useSymLinks,
		miseService,
	}: GenerateConfigProps) => Promise<Record<string, VSCodeSettingValue>>;
};

export const SUPPORTED_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionId: "ms-python.python",
		toolNames: ["python"],
		generateConfiguration: async ({
			tool,
			miseConfig,
			useShims,
			miseService,
			useSymLinks,
		}) => {
			const envs = await miseService.getEnvs();
			const virtualEnv = envs?.find((e) => e.name === "VIRTUAL_ENV");
			if (virtualEnv) {
				const workspaceRoot = miseService.getCurrentWorkspaceFolderPath();
				return {
					"python.defaultInterpreterPath": workspaceRoot
						? virtualEnv.value.replace(workspaceRoot, "${workspaceFolder}")
						: virtualEnv.value,
				};
			}

			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({
			tool,
			miseConfig,
			useShims,
			useSymLinks,
			miseService,
		}) => {
			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			const interpreterPath = useShims
				? path.join(miseConfig.dirs.shims, tool.name)
				: path.join(tool.install_path, "bin", tool.name);

			const configuredPath = useSymLinks
				? await miseService.createMiseToolSymlink(tool.name, interpreterPath)
				: interpreterPath;

			return {
				"ruff.path": [configuredPath],
			};
		},
	},
	{
		extensionId: "golang.go",
		toolNames: ["go"],
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			const goRoot = useSymLinks
				? await miseService.createMiseToolSymlink("goRoot", tool.install_path)
				: tool.install_path;

			const goBin = useShims
				? useSymLinks
					? await miseService.createMiseToolSymlink(
							"go",
							path.join(miseConfig.dirs.shims, "go"),
						)
					: path.join(miseConfig.dirs.shims, "go")
				: path.join(tool.install_path, "bin", "go");

			const dlvBin = useShims
				? useSymLinks
					? await miseService.createMiseToolSymlink(
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
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({ miseService, tool, useSymLinks }) => {
			return {
				"jdk.jdkhome": useSymLinks
					? await miseService.createMiseToolSymlink("java", tool.install_path)
					: tool.install_path,
			};
		},
	},
	{
		extensionId: "timonwong.shellcheck",
		toolNames: ["shellcheck"],
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			const interpreterPath = useShims
				? path.join(miseConfig.dirs.shims, tool.name)
				: path.join(tool.install_path, "bin", tool.name);

			const configuredPath = useSymLinks
				? await miseService.createMiseToolSymlink(tool.name, interpreterPath)
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
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
		}) => {
			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
		}) => {
			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
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
		generateConfiguration: async ({ tool, miseService, useSymLinks }) => {
			const pathToBin = path.join(tool.install_path, "bin");
			return {
				"erlang.erlangPath": useSymLinks
					? await miseService.createMiseToolSymlink("erlang", pathToBin)
					: pathToBin,
			};
		},
	},
	{
		toolNames: ["dart", "vfox:version-fox/vfox-dart"],
		extensionId: "Dart-Code.dart-code",
		generateConfiguration: async ({ tool }) => {
			return {
				"dart.sdkPath": tool.install_path,
			};
		},
	},
	{
		toolNames: ["flutter", "vfox:version-fox/vfox-flutter"],
		extensionId: "dart-code.flutter",
		generateConfiguration: async ({ tool }) => {
			return {
				"dart.flutterSdkPath": tool.install_path,
			};
		},
	},
	{
		toolNames: ["zig"],
		extensionId: "ziglang.vscode-zig",
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
				configKey: "zig.path",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["zls", "ubi:zigtools/zls", "aqua:zigtools/zls"],
		extensionId: "ziglang.vscode-zig",
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
				configKey: "zig.zls.path",
				binName: "zls",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
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
