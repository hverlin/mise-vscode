import * as os from "node:os";
import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME,
	configureExtension,
} from "../utils/configureExtensionUtil";
import { logger } from "../utils/logger";

type TreeItem = SourceItem | ToolItem;

export const MISE_OPEN_TOOL_DEFINITION = "mise.openToolDefinition";
export const MISE_REMOVE_TOOL = "mise.removeTool";
export const MISE_INSTALL_TOOL = "mise.installTool";
export const MISE_INSTALL_ALL = "mise.installAll";
export const MISE_USE_TOOL = "mise.useTool";
export const MISE_COPY_TOOL_INSTALL_PATH = "mise.copyToolInstallPath";
export const MISE_COPY_TOOL_BIN_PATH = "mise.copyToolBinPath";

export class MiseToolsProvider implements vscode.TreeDataProvider<TreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<
		TreeItem | undefined | null | void
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private miseService: MiseService) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	async getTools(): Promise<MiseTool[]> {
		return this.miseService.getCurrentTools();
	}

	getMiseService(): MiseService {
		return this.miseService;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		if (!element) {
			const tools = await this.miseService.getCurrentTools();
			const configFiles = await this.miseService.getMiseConfigFiles();
			const toolsBySource = this.groupToolsBySource(tools);
			for (const configFile of configFiles) {
				if (!toolsBySource[configFile.path]) {
					toolsBySource[configFile.path] = [];
				}
				toolsBySource[configFile.path]?.push(
					...configFile.tools
						.filter(
							(tool) =>
								!tools.find(
									(t) => t.name === tool && t.source?.path === configFile.path,
								),
						)
						.map((tool) => ({
							name: tool,
							version: "",
							source: { type: "file", path: configFile.path },
							requested_version: "",
							installed: true,
							active: false,
							install_path: "-",
						})),
				);
			}

			return Object.entries(toolsBySource).map(
				([source, tools]) => new SourceItem(source, tools),
			);
		}

		if (element instanceof SourceItem) {
			return element.tools.map((tool) => new ToolItem(tool));
		}

		return [];
	}

	private groupToolsBySource(tools: MiseTool[]): Record<string, MiseTool[]> {
		const groupedTools: Record<string, MiseTool[]> = {};
		for (const tool of tools) {
			const source = tool.source?.path || "Unknown";
			if (!groupedTools[source]) {
				groupedTools[source] = [];
			}
			groupedTools[source].push(tool);
		}
		return groupedTools;
	}
}

class SourceItem extends vscode.TreeItem {
	constructor(
		public readonly source: string,
		public readonly tools: MiseTool[],
	) {
		const pathShown = source
			.replace(`${vscode.workspace.rootPath}/` || "", "")
			.replace(os.homedir(), "~");

		super(
			pathShown,
			tools.length === 0
				? vscode.TreeItemCollapsibleState.None
				: pathShown.startsWith("/") || pathShown.startsWith("~")
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.Expanded,
		);

		this.tooltip = `Source: ${source}
Number of tools: ${tools.length}`;

		this.contextValue = "source";
		this.description = `(${tools.length} tools)`;
	}
}

class ToolItem extends vscode.TreeItem {
	tool: MiseTool;
	constructor(tool: MiseTool) {
		super(
			[
				tool.name,
				tool.version,
				tool.requested_version ? `(${tool.requested_version})` : "",
			]
				.filter(Boolean)
				.join(" "),
			vscode.TreeItemCollapsibleState.None,
		);
		this.tool = tool;
		this.tooltip = `Tool: ${tool.name}
Version: ${tool.version}
Requested Version: ${tool.requested_version}
Source: ${tool.source?.path || "Unknown"}
Activated: ${tool.active}
Installed: ${tool.installed}
Install Path: ${tool.install_path}`;

		this.iconPath = this.getToolIcon(tool);
		this.contextValue = !tool.version
			? ""
			: tool.installed
				? "tool-installed"
				: "tool-notinstalled";

		if (tool.source?.path) {
			this.command = {
				command: MISE_OPEN_TOOL_DEFINITION,
				title: "Open Tool Definition",
				arguments: [tool],
			};
		}
	}

	private getToolIcon(tool: MiseTool): vscode.ThemeIcon {
		if (!tool.installed) {
			return new vscode.ThemeIcon("alert");
		}
		if (tool.active) {
			return new vscode.ThemeIcon("check");
		}
		return new vscode.ThemeIcon("circle-filled");
	}
}

export function registerToolsCommands(
	context: vscode.ExtensionContext,
	toolsProvider: MiseToolsProvider,
) {
	const miseService = toolsProvider.getMiseService();

	context.subscriptions.push(
		vscode.commands.registerCommand(
			MISE_OPEN_TOOL_DEFINITION,
			async (tool: MiseTool | undefined) => {
				let selectedTool = tool;
				if (!selectedTool) {
					const tools = await toolsProvider.getTools();
					const toolNames = tools.map(
						(tool) => `${tool.name} | ${tool.version}`,
					);
					const selectedToolName = await vscode.window.showQuickPick(
						toolNames,
						{ canPickMany: false, placeHolder: "Select a tool to open" },
					);
					selectedTool = tools.find(
						(tool) => `${tool.name} | ${tool.version}` === selectedToolName,
					);
				}

				if (!selectedTool?.source?.path) {
					return;
				}

				const document = await vscode.workspace.openTextDocument(
					selectedTool.source.path,
				);
				const editor = await vscode.window.showTextDocument(document);

				let line = 0;
				for (let i = 0; i < editor.document.getText().split("\n").length; i++) {
					const l = editor.document.getText().split("\n")[i];
					if (!l) {
						continue;
					}

					const [firstWord] = l.replace(/\s/g, "").replace(/"/g, "").split("=");
					if (firstWord === selectedTool.name) {
						line = i + 1;
						break;
					}
				}

				if (line) {
					const position = new vscode.Position(Math.max(0, line - 1), 0);
					const position2 = new vscode.Position(
						Math.max(0, line - 1),
						selectedTool.name.includes(":")
							? selectedTool.name.length + 2
							: selectedTool.name.length,
					);
					editor.selection = new vscode.Selection(position, position2);
					editor.revealRange(
						new vscode.Range(position, position2),
						vscode.TextEditorRevealType.InCenter,
					);
				}
			},
		),

		vscode.commands.registerCommand(
			MISE_REMOVE_TOOL,
			async (inputTool: undefined | MiseTool | ToolItem) => {
				let tool = inputTool;
				if (!tool) {
					const tools = await toolsProvider.getTools();
					const toolNames = tools
						.filter((tool) => tool.installed)
						.map((tool) => `${tool.name} ${tool.version}`);

					const selectedToolName = await vscode.window.showQuickPick(
						toolNames,
						{ canPickMany: false, placeHolder: "Select a tool to remove" },
					);

					tool = tools.find(
						(tool) => `${tool.name} ${tool.version}` === selectedToolName,
					);
				} else if (inputTool instanceof ToolItem) {
					tool = inputTool.tool;
				}

				if (!tool) {
					return;
				}

				tool = tool as MiseTool;
				const confirmed = await vscode.window.showWarningMessage(
					`Are you sure you want to remove ${tool.name} ${tool.version}?`,
					{ modal: true },
					"Remove",
				);

				if (confirmed === "Remove") {
					await miseService.runMiseToolActionInConsole(
						`rm ${tool.name}@${tool.version}`,
						"Remove Tool",
					);
				}
			},
		),

		vscode.commands.registerCommand(
			MISE_INSTALL_TOOL,
			async (inputTool: undefined | MiseTool | ToolItem) => {
				let tool = inputTool;
				if (!tool) {
					const tools = await toolsProvider.getTools();
					const toolNames = tools
						.filter((tool) => !tool.installed)
						.map((tool) => `${tool.name} ${tool.version}`);
					const selectedToolName = await vscode.window.showQuickPick(
						toolNames,
						{ canPickMany: false, placeHolder: "Select a tool to install" },
					);
					tool = tools.find(
						(tool) => `${tool.name} ${tool.version}` === selectedToolName,
					);
				} else if (inputTool instanceof ToolItem) {
					tool = inputTool.tool;
				}

				if (!tool) {
					return;
				}

				tool = tool as MiseTool;
				await miseService.runMiseToolActionInConsole(
					`install ${tool.name}@${tool.requested_version}`,
					"Install Tool",
				);
			},
		),

		vscode.commands.registerCommand(MISE_INSTALL_ALL, async () => {
			await miseService.runMiseToolActionInConsole("install", "Install Tool");
		}),

		vscode.commands.registerCommand(
			MISE_USE_TOOL,
			async (path: string | SourceItem | undefined) => {
				let selectedPath = path;
				if (!selectedPath) {
					const miseConfigFiles = await miseService.getMiseConfigFiles();

					selectedPath = await vscode.window.showQuickPick(
						miseConfigFiles.length > 0
							? miseConfigFiles.map((file) => file.path)
							: ["~/.config/mise/config.toml"],
						{ placeHolder: "Select a configuration file" },
					);
				} else if (selectedPath instanceof SourceItem) {
					selectedPath = path instanceof SourceItem ? path.source : path;
				}

				if (!selectedPath) {
					return;
				}

				const registry = await miseService.miseRegistry();
				const selection = await vscode.window.showQuickPick(
					[
						{ label: "custom", description: "Enter a custom tool name" },
						...registry.map(
							(tool) =>
								({
									label: `${tool.short}`,
									description: tool.full,
								}) as vscode.QuickPickItem,
						),
					],
					{
						placeHolder: "Search for a tool to install (e.g. node)",
						canPickMany: false,
					},
				);

				if (!selection) {
					return;
				}

				let selectedToolName: string | undefined;
				if (selection.label === "custom") {
					selectedToolName = await vscode.window.showInputBox({
						placeHolder: "Enter the tool name to use (e.g. node@latest)",
						validateInput: (input) => {
							if (!input) {
								return "Tool name is required";
							}
							if (/[^@]+@[^@]+/.test(input)) {
								return "Tool name must include a version (e.g. node@latest or node@20)";
							}
							return null;
						},
					});
				} else {
					selectedToolName = selection.label;
					const availableVersions =
						await miseService.listRemoteVersions(selectedToolName);
					const selectedVersion = await vscode.window.showQuickPick(
						["latest"].concat(availableVersions),
						{ placeHolder: "Select a version to use", canPickMany: false },
					);
					if (!selectedVersion) {
						return;
					}
					selectedToolName = `${selectedToolName}@${selectedVersion}`;
				}

				if (!selectedToolName) {
					return;
				}

				await miseService.runMiseToolActionInConsole(
					`use --path ${selectedPath} ${selectedToolName}`,
					"Use Tool",
				);
			},
		),

		vscode.commands.registerCommand(
			MISE_COPY_TOOL_INSTALL_PATH,
			async (providedTool: MiseTool | ToolItem) => {
				let tool = providedTool;
				if (tool instanceof ToolItem) {
					tool = tool.tool;
				}

				if (!tool) {
					return;
				}

				await vscode.env.clipboard.writeText(tool.install_path);
				vscode.window.showInformationMessage(
					`Copied install path to clipboard: ${tool.install_path}`,
				);
			},
		),

		vscode.commands.registerCommand(
			MISE_COPY_TOOL_BIN_PATH,
			async (providedTool: MiseTool | ToolItem) => {
				let tool = providedTool;
				if (tool instanceof ToolItem) {
					tool = tool.tool;
				}

				if (!tool) {
					return;
				}

				const binPath = await miseService.miseWhich(tool.name);
				await vscode.env.clipboard.writeText(binPath);
				vscode.window.showInformationMessage(
					`Copied bin path to clipboard: ${binPath}`,
				);
			},
		),

		vscode.commands.registerCommand(
			"mise.configureSdkPath",
			async (toolName: string | undefined) => {
				await miseService.miseReshim();

				let selectedToolName = toolName;

				const tools = await toolsProvider.getTools();
				const configurableTools = tools.filter((tool) => {
					const configurableExtension =
						CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(tool.name);
					if (!configurableExtension) {
						return false;
					}

					return vscode.extensions.getExtension(
						configurableExtension.extensionName,
					);
				});

				if (!configurableTools.length) {
					vscode.window.showErrorMessage(
						"No configurable tools found. Please install a tool first.",
					);
					return;
				}

				if (
					selectedToolName &&
					!CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.has(selectedToolName)
				) {
					vscode.window.showErrorMessage(
						`Tool ${toolName} is not configurable (not supported yet)`,
					);
					return;
				}

				if (!toolName) {
					selectedToolName = await vscode.window.showQuickPick(
						configurableTools.map((tool) => tool.name),
						{ canPickMany: false, placeHolder: "Select a tool to configure" },
					);
				}

				if (!selectedToolName) {
					return;
				}

				const useShimsDefault = vscode.workspace
					.getConfiguration("mise")
					.get("configureExtensionsUseShims");

				const useMiseShims = await vscode.window.showQuickPick(
					useShimsDefault ? ["Yes", "No"] : ["No", "Yes"],
					{
						placeHolder: `Use mise shims for ${selectedToolName}? (recommended as it will automatically load environment variables)`,
						ignoreFocusOut: true,
					},
				);

				if (!useMiseShims) {
					return;
				}

				const selectedTool = configurableTools.find(
					(tool) => tool.name === selectedToolName,
				);
				const configurableTool =
					CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(selectedToolName);

				if (!configurableTool || !selectedTool) {
					return;
				}

				const miseConfig = await miseService.getMiseConfiguration();
				configureExtension({
					tool: selectedTool,
					miseConfig: miseConfig,
					configurableExtension: configurableTool,
					useShims: useMiseShims === "Yes",
					useSymLinks: vscode.workspace
						.getConfiguration("mise")
						.get("configureExtensionsUseSymLinks"),
				}).catch((error) => {
					logger.error(
						`Failed to configure the extension ${configurableTool.extensionName} for ${selectedTool.name}: ${error}`,
					);
				});
			},
		),
		vscode.commands.registerCommand("mise.configureAllSdkPaths", async () => {
			await miseService.miseReshim();

			const tools = await toolsProvider.getTools();
			const configurableTools = tools.filter((tool) => {
				const configurableExtension = CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(
					tool.name,
				);
				if (!configurableExtension) {
					return false;
				}

				return vscode.extensions.getExtension(
					configurableExtension.extensionName,
				);
			});

			if (!configurableTools.length) {
				return;
			}

			const miseConfig = await miseService.getMiseConfiguration();

			await Promise.allSettled(
				configurableTools
					.filter((tool) => tool.installed)
					.map(async (tool) => {
						const configurableTool = CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(
							tool.name,
						);
						if (!configurableTool) {
							return;
						}

						try {
							await configureExtension({
								tool: tool,
								miseConfig: miseConfig,
								configurableExtension: configurableTool,
								useSymLinks: vscode.workspace
									.getConfiguration("mise")
									.get("configureExtensionsUseSymLinks"),
								useShims: vscode.workspace
									.getConfiguration("mise")
									.get("configureExtensionsUseShims"),
							});
						} catch (error) {
							logger.error(
								`Failed to configure the extension ${configurableTool.extensionName} for ${tool.name}: ${error}`,
							);
						}
					}),
			);
		}),
	);
}
