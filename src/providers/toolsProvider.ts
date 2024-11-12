import * as os from "node:os";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";

type TreeItem = SourceItem | ToolItem;

export const MISE_OPEN_TOOL_DEFINITION = "mise.openToolDefinition";
export const MISE_REMOVE_TOOL = "mise.removeTool";
export const MISE_INSTALL_TOOL = "mise.installTool";

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
		return this.miseService.getTools();
	}

	getMiseService(): MiseService {
		return this.miseService;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!element) {
			const tools = await this.miseService.getTools();
			const toolsBySource = this.groupToolsBySource(tools);

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
		return tools.reduce((acc: Record<string, MiseTool[]>, tool: MiseTool) => {
			const source = tool.source?.path || "Unknown";
			if (!acc[source]) {
				acc[source] = [];
			}
			acc[source].push(tool);
			return acc;
		}, {});
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
			pathShown.startsWith("/") || pathShown.startsWith("~")
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.Expanded,
		);

		this.tooltip = `Source: ${source}
Number of tools: ${tools.length}`;

		this.iconPath = new vscode.ThemeIcon("folder");
		this.contextValue = "source";
		this.description = `(${tools.length} tools)`;
	}
}

class ToolItem extends vscode.TreeItem {
	tool: MiseTool;
	constructor(tool: MiseTool) {
		super(
			`${tool.name} ${tool.version} (${tool.requested_version})`,
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
		this.contextValue = tool.installed ? "tool-installed" : "tool-notinstalled";

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

async function runMiseToolActionInConsole(
	toolsProvider: MiseToolsProvider,
	command: string,
	taskName: string,
): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel("mise");
	outputChannel.show();

	try {
		const miseCommand = toolsProvider
			.getMiseService()
			.createMiseCommand(command);
		outputChannel.appendLine(`> ${miseCommand}`);

		const execution = new vscode.ShellExecution(miseCommand);
		const task = new vscode.Task(
			{ type: "mise" },
			vscode.TaskScope.Workspace,
			taskName,
			"mise",
			execution,
		);

		await vscode.tasks.executeTask(task);
		const disposable = vscode.tasks.onDidEndTask((e) => {
			if (e.execution.task === task) {
				toolsProvider.refresh();
				disposable.dispose();
			}
		});
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to execute ${taskName}: ${error}`);
	}
}

export function registerCommands(
	context: vscode.ExtensionContext,
	toolsProvider: MiseToolsProvider,
) {
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
					await runMiseToolActionInConsole(
						toolsProvider,
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
				await runMiseToolActionInConsole(
					toolsProvider,
					`install ${tool.name}@${tool.requested_version}`,
					"Install Tool",
				);
			},
		),
	);
}
