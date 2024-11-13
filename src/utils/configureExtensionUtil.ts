import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { logger } from "./logger";
import type { MiseConfig } from "./miseDoctorParser";

type VSCodeConfigValue = string | Record<string, string> | Array<string>;

type ConfigurableExtension = {
	extensionName: string;
	toolName: string;
	generateConfiguration: (
		tool: MiseTool,
		miseConfig: MiseConfig,
		{ useShims }: { useShims: boolean },
	) => Promise<Record<string, VSCodeConfigValue>>;
};

export const CONFIGURABLE_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionName: "denoland.vscode-deno",
		toolName: "deno",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			return {
				"deno.path": useShims
					? path.join(miseConfig.dirs.shims, "bin", "deno")
					: path.join(tool.install_path, "bin", "deno"),
			};
		},
	},
	{
		extensionName: "charliermarsh.ruff",
		toolName: "ruff",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			return {
				"ruff.path": useShims
					? [path.join(miseConfig.dirs.shims, "bin", "ruff")]
					: [path.join(tool.install_path, "bin", "ruff")],
			};
		},
	},
	{
		extensionName: "golang.go",
		toolName: "go",
		generateConfiguration: async (
			tool: MiseTool,
			miseConfig: MiseConfig,
			{ useShims },
		) => {
			if (useShims) {
				return {
					"go.goroot": tool.install_path,
					"go.alternateTools": {
						go: path.join(miseConfig.dirs.shims, "bin", "go"),
						dlv: path.join(miseConfig.dirs.shims, "bin", "dlv"),
					},
				};
			}

			return {
				"go.goroot": tool.install_path,
				"go.alternateTools": {
					go: path.join(tool.install_path, "bin", "go"),
					dlv: path.join(tool.install_path, "bin", "dlv"),
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
			{ useShims },
		) => {
			return {
				"bun.runtime": useShims
					? path.join(miseConfig.dirs.shims, "bin", "bun")
					: path.join(tool.install_path, "bin", "bun"),
			};
		},
	},
];

export const CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME = new Map(
	CONFIGURABLE_EXTENSIONS.map((item) => [item.toolName, item]),
);

export async function configureExtension({
	tool,
	miseConfig,
	configurableExtension,
	useShims = true,
}: {
	tool: MiseTool;
	miseConfig: MiseConfig;
	configurableExtension: ConfigurableExtension;
	useShims?: boolean;
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

	const configuration = vscode.workspace.getConfiguration();
	const extConfig = await configurableExtension.generateConfiguration(
		tool,
		miseConfig,
		{ useShims },
	);

	const updatedKeys: string[] = [];
	for (const [configKey, configValue] of Object.entries(extConfig)) {
		const previousConfigValue = configuration.get(configKey);
		const updatedValueStringified = JSON.stringify(configValue);
		if (JSON.stringify(previousConfigValue) === updatedValueStringified) {
			continue;
		}

		await configuration.update(
			configKey,
			configValue,
			ConfigurationTarget.Workspace,
		);
		updatedKeys.push(`${configKey}: ${updatedValueStringified}`);
	}

	if (updatedKeys.length === 0) {
		return;
	}
	vscode.window.showInformationMessage(
		`Mise: Extension ${configurableExtension.extensionName} configured.\n${updatedKeys.join("\n")}`,
	);
}
