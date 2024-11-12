import * as os from "node:os";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";

type TreeItem = SourceItem | ToolItem;

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
	constructor(tool: MiseTool) {
		super(`${tool.name} ${tool.version}`, vscode.TreeItemCollapsibleState.None);

		this.tooltip = `Tool: ${tool.name}
Version: ${tool.version}
Requested Version: ${tool.requested_version}
Source: ${tool.source?.path || "Unknown"}
Activated: ${tool.active}
Installed: ${tool.installed}
Install Path: ${tool.install_path}`;

		this.iconPath = this.getToolIcon(tool);

		if (tool.source?.path) {
			this.command = {
				command: "mise.openToolDefinition",
				title: "Open Tool Definition",
				arguments: [tool],
			};
		}
	}

	private getToolIcon(tool: MiseTool): vscode.ThemeIcon {
		if (!tool.installed) {
			return new vscode.ThemeIcon("circle-outline");
		}
		if (tool.active) {
			return new vscode.ThemeIcon("check");
		}
		return new vscode.ThemeIcon("circle-filled");
	}
}

export function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"mise.openToolDefinition",
			async (tool: MiseTool) => {
				if (!tool.source?.path) {
					return;
				}

				const document = await vscode.workspace.openTextDocument(
					tool.source.path,
				);
				const editor = await vscode.window.showTextDocument(document);

				let line = 0;
				for (let i = 0; i < editor.document.getText().split("\n").length; i++) {
					const l = editor.document.getText().split("\n")[i];
					const [firstWord] = l.replace(/\s/g, "").replace(/"/g, "").split("=");
					if (firstWord === tool.name) {
						line = i + 1;
						break;
					}
				}

				if (line) {
					const position = new vscode.Position(Math.max(0, line - 1), 0);
					const position2 = new vscode.Position(
						Math.max(0, line - 1),
						tool.name.includes(":") ? tool.name.length + 2 : tool.name.length,
					);
					editor.selection = new vscode.Selection(position, position2);
					editor.revealRange(
						new vscode.Range(position, position2),
						vscode.TextEditorRevealType.InCenter,
					);
				}
			},
		),
	);
}
