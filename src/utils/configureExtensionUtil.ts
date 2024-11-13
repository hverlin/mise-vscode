import * as path from "node:path";
import * as vscode from "vscode";
import { ConfigurationTarget } from "vscode";
import { logger } from "./logger";

type ConfigurableExtension = {
	extensionName: string;
	toolName: string;
	configKey: string;
	configValue: (tool: MiseTool) => string | string[];
};

export const CONFIGURABLE_EXTENSIONS: Array<ConfigurableExtension> = [
	{
		extensionName: "denoland.vscode-deno",
		toolName: "deno",
		configKey: "deno.path",
		configValue: (tool: MiseTool) =>
			path.join(tool.install_path, "bin", "deno"),
	},
	{
		extensionName: "charliermarsh.ruff",
		toolName: "ruff",
		configKey: "ruff.path",
		configValue: (tool: MiseTool) => [
			path.join(tool.install_path, "bin", "ruff"),
		],
	},
	{
		extensionName: "golang.go",
		toolName: "go",
		configKey: "go.goroot",
		configValue: (tool: MiseTool) => path.join(tool.install_path),
	},
	{
		extensionName: "oven.bun-vscode",
		toolName: "bun",
		configKey: "bun.runtime",
		configValue: (tool: MiseTool) => path.join(tool.install_path, "bin", "bun"),
	},
];

export const CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME = new Map(
	CONFIGURABLE_EXTENSIONS.map((item) => [item.toolName, item]),
);

export async function configureExtension({
	extensionName,
	configKey,
	configValue,
}: {
	extensionName: string;
	configKey: string;
	configValue: string | string[];
}) {
	const extension = vscode.extensions.getExtension(extensionName);
	if (!extension) {
		logger.error(`Mise: Extension ${extensionName} is not installed`);
		return;
	}

	const configuration = vscode.workspace.getConfiguration();

	if (
		JSON.stringify(configuration.get(configKey)) === JSON.stringify(configValue)
	) {
		return;
	}

	await configuration.update(
		configKey,
		configValue,
		ConfigurationTarget.Workspace,
	);

	vscode.window.showInformationMessage(
		`Mise: Extension ${extensionName} configured.\n${configKey}: ${configValue}`,
	);
}
