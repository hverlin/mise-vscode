import * as vscode from "vscode";
import type { MiseService } from "../miseService";

export class MiseToolsProvider implements vscode.TreeDataProvider<ToolItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<
		ToolItem | undefined | null | void
	> = new vscode.EventEmitter<ToolItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		ToolItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	constructor(private miseService: MiseService) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ToolItem): vscode.TreeItem {
		return element;
	}

	async getChildren(): Promise<ToolItem[]> {
		const tools = await this.miseService.getTools();
		return tools.map((tool) => new ToolItem(tool));
	}
}

class ToolItem extends vscode.TreeItem {
	constructor(tool: MiseTool) {
		super(`${tool.name} ${tool.version}`, vscode.TreeItemCollapsibleState.None);
		this.tooltip = `Tool: ${tool.name}
Version: ${tool.version}
Requested Version: ${tool.requested_version}
Activated: ${tool.active}
Installed: ${tool.installed}
Install Path: ${tool.install_path}`;
	}
}
