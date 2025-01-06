import * as vscode from "vscode";
import {
	MISE_CONFIGURE_ALL_SKD_PATHS,
	MISE_CONFIGURE_SDK_PATH,
	MISE_COPY_TOOL_BIN_PATH,
	MISE_COPY_TOOL_INSTALL_PATH,
	MISE_INSTALL_ALL,
	MISE_INSTALL_TOOL,
	MISE_OPEN_FILE,
	MISE_OPEN_TOOL_DEFINITION,
	MISE_OPEN_TOOL_REPOSITORY,
	MISE_RELOAD,
	MISE_REMOVE_TOOL,
	MISE_USE_TOOL,
} from "../commands";
import {
	getIgnoreList,
	isMiseExtensionEnabled,
	shouldUseShims,
	shouldUseSymLinks,
} from "../configuration";
import type { MiseService } from "../miseService";
import { configureExtension } from "../utils/configureExtensionUtil";
import {
	displayPathRelativeTo,
	expandPath,
	isWindows,
} from "../utils/fileUtils";
import { logger } from "../utils/logger";
import { findToolPosition } from "../utils/miseFileParser";
import { getWebsiteForTool } from "../utils/miseUtilts";
import { CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME } from "../utils/supportedExtensions";

type TreeItem = ToolsSourceItem | ToolItem;

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

	async getToolsSourceItems() {
		const [tools, configFiles] = await Promise.all([
			this.miseService.getCurrentTools(),
			this.miseService.getMiseConfigFiles(),
		]);

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

		const currentWorkspaceFolderPath =
			this.miseService.getCurrentWorkspaceFolderPath();

		return Object.entries(toolsBySource)
			.sort(([sourceA], [sourceB]) => {
				// keep original order of config files
				const indexA = configFiles.findIndex((file) => file.path === sourceA);
				const indexB = configFiles.findIndex((file) => file.path === sourceB);
				if (indexA !== -1 && indexB !== -1) {
					return indexB - indexA;
				}
				return sourceA.localeCompare(sourceB);
			})
			.map(
				([source, tools]) =>
					new ToolsSourceItem(currentWorkspaceFolderPath || "", source, tools),
			);
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		if (!element) {
			try {
				return await this.getToolsSourceItems();
			} catch (error) {
				logger.info("Failed to get tools source items", error);
				vscode.commands.executeCommand(
					"setContext",
					"mise.toolsProviderError",
					true,
				);
				return [];
			}
		}

		if (element instanceof ToolsSourceItem) {
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

class ToolsSourceItem extends vscode.TreeItem {
	constructor(
		readonly workspaceFolderPath: string,
		public readonly source: string,
		public readonly tools: MiseTool[],
	) {
		const pathShown = displayPathRelativeTo(source, workspaceFolderPath);

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

		this.contextValue = "miseToolGroup";
		this.description = `(${
			tools.length === 0
				? "no tools"
				: `${tools.length} tool${tools.length > 1 ? "s" : ""}`
		})`;
		if (tools.length === 0) {
			this.collapsibleState = vscode.TreeItemCollapsibleState.None;
			this.iconPath = new vscode.ThemeIcon("chevron-right");
			this.command = {
				command: MISE_OPEN_FILE,
				title: "Open file",
				arguments: [this.source],
			};
		}
	}
}

class ToolItem extends vscode.TreeItem {
	tool: MiseTool;
	constructor(tool: MiseTool) {
		super(
			[tool.name, tool.version].filter(Boolean).join(" "),
			vscode.TreeItemCollapsibleState.None,
		);
		this.description = tool.requested_version;
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
	miseService: MiseService,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			MISE_OPEN_TOOL_DEFINITION,
			async (tool: MiseTool | string | undefined) => {
				let selectedTool = tool;
				if (typeof selectedTool === "string") {
					const tools = await miseService.getCurrentTools();
					selectedTool = tools.find((t) => t.name === tool);
				}
				if (!selectedTool) {
					const tools = await miseService.getCurrentTools();
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
				const range = findToolPosition(document, selectedTool.name);
				if (range) {
					editor.selection = new vscode.Selection(range.start, range.end);
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
				}
			},
		),

		vscode.commands.registerCommand(
			MISE_REMOVE_TOOL,
			async (inputTool: undefined | MiseTool | ToolItem) => {
				let tool = inputTool;
				if (!tool) {
					const tools = await miseService.getCurrentTools();
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
				await miseService.removeToolInConsole(tool.name, tool.version);
				if (tool.source?.path.endsWith(".toml")) {
					const removeToolFromConfigFile = await vscode.window.showQuickPick(
						["Yes", "No"],
						{
							placeHolder: `Remove tool from configuration file? ${tool.source.path}`,
							ignoreFocusOut: true,
						},
					);
					if (removeToolFromConfigFile === "Yes") {
						await miseService.useRmTool(
							expandPath(tool.source?.path || ""),
							tool.name,
						);
					}
				}
			},
		),

		vscode.commands.registerCommand(
			MISE_INSTALL_TOOL,
			async (inputTool: undefined | MiseTool | ToolItem) => {
				let tool = inputTool;
				if (!tool) {
					const tools = await miseService.getCurrentTools();
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
			await vscode.commands.executeCommand(MISE_RELOAD);
		}),
		vscode.commands.registerCommand(
			MISE_USE_TOOL,
			async (path: string | ToolsSourceItem | undefined) => {
				let selectedPath = path;
				if (!selectedPath) {
					selectedPath = await vscode.window.showQuickPick(
						await miseService.getMiseTomlConfigFilePathsEvenIfMissing(),
						{ placeHolder: "Select a configuration file" },
					);
				} else if (selectedPath instanceof ToolsSourceItem) {
					selectedPath = path instanceof ToolsSourceItem ? path.source : path;
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
						matchOnDescription: true,
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
						{
							placeHolder: "Select a version to use",
							canPickMany: false,
						},
					);
					if (!selectedVersion) {
						return;
					}
					selectedToolName = `${selectedToolName}@${selectedVersion}`;
				}

				if (!selectedToolName) {
					return;
				}

				const normalizedPath = isWindows
					? selectedPath.replace(/\\/g, "/").replace(/^\//, "")
					: selectedPath;

				await miseService.runMiseToolActionInConsole(
					`use --path ${normalizedPath} ${selectedToolName}`,
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

				const binPath = await miseService.getAllBinsForTool(tool.name);
				await vscode.env.clipboard.writeText(binPath.join("\n"));
				vscode.window.showInformationMessage(
					`Copied bin paths to clipboard: ${binPath}`,
				);
			},
		),

		vscode.commands.registerCommand(
			MISE_OPEN_TOOL_REPOSITORY,
			async (providedTool: MiseTool | ToolItem | undefined) => {
				let tool = providedTool;
				if (!tool) {
					const tools = await miseService.getCurrentTools();
					const toolNames = tools.map((tool) => tool.name);
					const selectedToolName = await vscode.window.showQuickPick(
						toolNames,
						{ canPickMany: false, placeHolder: "Select a tool to open" },
					);
					tool = tools.find((tool) => tool.name === selectedToolName);
				}

				if (tool instanceof ToolItem) {
					tool = tool.tool;
				}

				if (!tool) {
					return;
				}

				const toolInfo = await miseService.miseToolInfo(tool.name);
				if (!toolInfo) {
					return;
				}

				const uri = await getWebsiteForTool(toolInfo);
				if (!uri) {
					return;
				}
				vscode.env.openExternal(vscode.Uri.parse(uri));
			},
		),

		vscode.commands.registerCommand(
			MISE_CONFIGURE_SDK_PATH,
			async (toolName: string | undefined) => {
				await miseService.miseReshim();

				let selectedToolName = toolName;

				const tools = await miseService.getCurrentTools();
				const configurableTools = tools.filter((tool) => {
					const configurableExtensions =
						CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(tool.name);

					return configurableExtensions?.some((configurableExtension) => {
						return vscode.extensions.getExtension(
							configurableExtension.extensionId,
						);
					});
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

				const useMiseShims = await vscode.window.showQuickPick(
					shouldUseShims() ? ["Yes", "No"] : ["No", "Yes"],
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
				const configurableExtensions =
					CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(selectedToolName);

				if (!configurableExtensions?.length || !selectedTool) {
					return;
				}

				const miseConfig = await miseService.getMiseConfiguration();
				const useSymLinks = shouldUseSymLinks();
				const useShims = useMiseShims === "Yes";
				for (const configurableExtension of configurableExtensions) {
					configureExtension({
						tool: selectedTool,
						miseConfig,
						configurableExtension,
						useShims,
						miseService,
						useSymLinks,
					})
						.then(({ configurableExtension, updatedKeys }) => {
							if (updatedKeys.length === 0) {
								return;
							}

							vscode.window
								.showInformationMessage(
									`Mise: Extension ${configurableExtension.extensionId} configured.\n(updated: ${updatedKeys.join("\n")})`,
									"Show settings",
								)
								.then((selection) => {
									if (selection === "Show settings") {
										vscode.commands.executeCommand(
											"workbench.action.openWorkspaceSettingsFile",
										);
									}
								});
						})
						.catch((error) => {
							logger.error(
								`Failed to configure the extension ${configurableExtension.extensionId} for ${selectedTool.name}: ${error}`,
							);
						});
				}
			},
		),
		vscode.commands.registerCommand(MISE_CONFIGURE_ALL_SKD_PATHS, async () => {
			await miseService.miseReshim();
			const ignoreList = getIgnoreList();
			const tools = await miseService.getCurrentTools();
			const configurableTools = tools.filter((tool) => {
				const configurableExtensions = CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(
					tool.name,
				);
				if (!configurableExtensions?.length) {
					return false;
				}

				return configurableExtensions.some((configurableExtension) => {
					return ignoreList.includes(configurableExtension.extensionId)
						? false
						: vscode.extensions.getExtension(configurableExtension.extensionId);
				});
			});

			if (!configurableTools.length) {
				return;
			}

			const miseConfig = await miseService.getMiseConfiguration();

			const notificationContent: string[] = [];
			const configurableExtensionsWithTools = configurableTools
				.filter((tool) => tool.installed)
				.flatMap((tool) => {
					const configurableExtensions =
						CONFIGURABLE_EXTENSIONS_BY_TOOL_NAME.get(tool.name);

					if (!configurableExtensions?.length) {
						return [];
					}

					return configurableExtensions.map((configurableExtension) => ({
						tool,
						configurableExtension,
					}));
				});

			await Promise.allSettled(
				configurableExtensionsWithTools.map(
					async ({ tool, configurableExtension }) => {
						try {
							const { updatedKeys } = await configureExtension({
								tool: tool,
								miseConfig: miseConfig,
								configurableExtension,
								miseService,
								useSymLinks: shouldUseSymLinks(),
								useShims: shouldUseShims(),
							});

							if (updatedKeys.length === 0) {
								return;
							}

							notificationContent.push(
								`${configurableExtension.extensionId} (${updatedKeys.join(", ")})`,
							);
						} catch (error) {
							logger.error(
								`Failed to configure the extension ${configurableExtension.extensionId} for ${tool.name}: ${error}`,
							);
						}
					},
				),
			);

			if (notificationContent.length === 0) {
				return;
			}

			vscode.window
				.showInformationMessage(
					`Mise: Configured extensions:\n${notificationContent.join(",\n")}`,
					"Show settings",
				)
				.then((selection) => {
					if (selection === "Show settings") {
						vscode.commands.executeCommand(
							"workbench.action.openWorkspaceSettingsFile",
						);
					}
				});
		}),
	);
}
