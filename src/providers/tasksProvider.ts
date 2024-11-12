import * as vscode from "vscode";
import type { MiseService } from "../miseService";

export class MiseTasksProvider implements vscode.TreeDataProvider<TaskItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<
		TaskItem | undefined | null | void
	> = new vscode.EventEmitter<TaskItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		TaskItem | undefined | null | void
	> = this._onDidChangeTreeData.event;

	constructor(private miseService: MiseService) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TaskItem): vscode.TreeItem {
		return element;
	}

	async getChildren(): Promise<TaskItem[]> {
		const tasks = await this.miseService.getTasks();
		return tasks.map((task) => new TaskItem(task));
	}
}

class TaskItem extends vscode.TreeItem {
	constructor(task: MiseTask) {
		super(task.name, vscode.TreeItemCollapsibleState.None);
		this.tooltip = `Task: ${task.name}\nSource: ${task.source}\nDescription: ${task.description}`;
	}
}
