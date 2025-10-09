import * as path from "node:path";
import type { VSCodeSettingValue } from "../configuration";
import type { MiseService } from "../miseService";
import {
	configureSimpleExtension,
	getConfiguredBinPath,
} from "./configureExtensionUtil";
import { mergeArrays } from "./fn";

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
	}: GenerateConfigProps) => Promise<
		Record<string, VSCodeSettingValue | undefined>
	>;
};

const generateJavaConfiguration =
	(keyName: string) => async (config: GenerateConfigProps) => {
		return {
			[keyName]: config.useSymLinks
				? await config.miseService.createMiseToolSymlink(
						"java",
						config.tool.install_path,
					)
				: config.tool.install_path,
		};
	};

export const SUPPORTED_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionId: "ms-python.python",
		toolNames: ["python"],
		generateConfiguration: async ({
			tool,
			miseConfig,
			miseService,
			useSymLinks,
		}) => {
			const envs = await miseService.getEnvs();
			const virtualEnv = envs?.find((e) => e.name === "VIRTUAL_ENV");
			if (virtualEnv) {
				const workspaceRoot = miseService.getCurrentWorkspaceFolderPath();
				return {
					"python.defaultInterpreterPath": workspaceRoot
						? // biome-ignore lint/suspicious/noTemplateCurlyInString: expected
							virtualEnv.value.replace(workspaceRoot, "${workspaceFolder}")
						: virtualEnv.value,
				};
			}

			return configureSimpleExtension(miseService, {
				configKey: "python.defaultInterpreterPath",
				useShims: false, // https://github.com/hverlin/mise-vscode/issues/93
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
			miseService,
		}) => {
			return configureSimpleExtension(miseService, {
				configKey: "deno.path",
				// extension is `deno.exe` on windows
				windowsExtOptional: true,
				useShims,
				useSymLinks: false, // disabled until https://github.com/denoland/vscode_deno/pull/1245 is merged
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
			const [ruffBin, ruffInterpreter] = await Promise.all([
				configureSimpleExtension(miseService, {
					useShims,
					useSymLinks,
					tool,
					miseConfig,
					configKey: "ruff.path",
					binName: "ruff",
					valueTransformer: (bin: string) => [bin],
				}),
				configureSimpleExtension(miseService, {
					useShims,
					useSymLinks,
					tool,
					miseConfig,
					configKey: "ruff.interpreter",
					binName: "python",
					valueTransformer: (bin: string) => [bin],
				}),
			]);

			return {
				...ruffBin,
				...ruffInterpreter,
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

			const getConfiguredGoBin = (name: string, { optional = false } = {}) =>
				getConfiguredBinPath(miseService, {
					useShims,
					useSymLinks,
					tool,
					miseConfig,
					binName: name,
					windowsShimOnlyEXE: true, // if use `go.cmd`, error EINVAL,
					windowsExtOptional: optional,
				});

			const [goBin, dlvBin, goplsBin] = await Promise.all([
				getConfiguredGoBin("go", { optional: true }),
				// if `dlv.exe` not exist in `GOBIN`
				// Go extension will install dlv.exe to `GOBIN`
				// but it will use `dlv.exe` in `shims`
				// if use `dlv`, it will use dlv.exe in `GOBIN`
				getConfiguredGoBin("dlv"),
				// like `dlv`
				getConfiguredGoBin("gopls"),
			]);

			return {
				"go.goroot": goRoot,
				"go.alternateTools": mergeArrays([
					["go", goBin],
					["dlv", dlvBin],
					["gopls", goplsBin],
				]),
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
		generateConfiguration: generateJavaConfiguration("jdk.jdkhome"),
	},
	{
		extensionId: "redhat.java",
		toolNames: ["java"],
		generateConfiguration: generateJavaConfiguration("java.jdt.ls.java.home"),
	},
	{
		extensionId: "vscjava.vscode-gradle",
		toolNames: ["java"],
		generateConfiguration: generateJavaConfiguration(
			"java.import.gradle.java.home",
		),
	},
	{
		extensionId: "salesforce.salesforcedx-vscode-apex",
		toolNames: ["java"],
		generateConfiguration: generateJavaConfiguration(
			"salesforcedx-vscode-apex.java.home",
		),
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
			return configureSimpleExtension(miseService, {
				configKey: "debug.javascript.defaultRuntimeExecutable",
				useShims,
				// NodeJS on windows only allows `.exe`, no `.cmd` by default. See https://github.com/jdx/mise/discussions/4360
				windowsShimOnlyEXE: false,
				windowsExtOptional: true,
				useSymLinks,
				tool,
				miseConfig,
				valueTransformer: (bin: string) => {
					return {
						"pwa-node": bin,
					};
				},
			});
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
		generateConfiguration: async ({ miseService, tool, miseConfig }) => {
			return configureSimpleExtension(miseService, {
				configKey: "zig.path",
				useShims: false,
				useSymLinks: false,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["zls", "ubi:zigtools/zls", "aqua:zigtools/zls"],
		extensionId: "ziglang.vscode-zig",
		generateConfiguration: async ({ miseService, tool, miseConfig }) => {
			return configureSimpleExtension(miseService, {
				configKey: "zig.zls.path",
				binName: "zls",
				useShims: false,
				useSymLinks: false,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["sops"],
		extensionId: "signageos.signageos-vscode-sops",
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
				configKey: "sops.binPath",
				useShims,
				useSymLinks,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["ginkgo"],
		extensionId: "joselitofilho.ginkgotestexplorer",
		generateConfiguration: async ({ miseService, tool, miseConfig }) => {
			return configureSimpleExtension(miseService, {
				configKey: "ginkgotestexplorer.ginkgoPath",
				useShims: false,
				useSymLinks: false,
				tool,
				miseConfig,
			});
		},
	},
	{
		toolNames: ["buf", "aqua:bufbuild/buf", "ubi:bufbuild/buf", "asdf:truepay/asdf-buf"],
		extensionId: "bufbuild.vscode-buf",
		generateConfiguration: async ({
			miseService,
			tool,
			miseConfig,
			useShims,
			useSymLinks,
		}) => {
			return configureSimpleExtension(miseService, {
				configKey: "buf.commandLine.path",
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
