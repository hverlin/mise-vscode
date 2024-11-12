import * as vscode from "vscode";
import type { MiseService } from "../miseService";

export class MiseTasksProvider implements vscode.TreeDataProvider<TreeNode> {
	private _onDidChangeTreeData: vscode.EventEmitter<
		TreeNode | undefined | null | void
	> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		TreeNode | undefined | null | void
	> = this._onDidChangeTreeData.event;

	constructor(private miseService: MiseService) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		if (!element) {
			// Root level - return source groups
			const tasks = await this.miseService.getTasks();
			const groupedTasks = this.groupTasksBySource(tasks);

			return Object.entries(groupedTasks).map(
				([source, tasks]) => new SourceGroupItem(source, tasks),
			);
		}

		if (element instanceof SourceGroupItem) {
			// Source group level - return tasks
			return element.tasks.map((task) => new TaskItem(task));
		}

		return [];
	}

	private groupTasksBySource(tasks: MiseTask[]): Record<string, MiseTask[]> {
		return tasks.reduce(
			(groups, task) => {
				const source = task.source || "Unknown";
				if (!groups[source]) {
					groups[source] = [];
				}
				groups[source].push(task);
				return groups;
			},
			{} as Record<string, MiseTask[]>,
		);
	}

	async runTask(taskItem: TaskItem) {
		try {
			await this.miseService.runTask(taskItem.task.name);
			vscode.window.showInformationMessage(
				`Task '${taskItem.task.name}' started`,
			);
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to run task '${taskItem.task.name}': ${error}`,
			);
		}
	}
}

type TreeNode = SourceGroupItem | TaskItem;

class SourceGroupItem extends vscode.TreeItem {
	constructor(
		public readonly source: string,
		public readonly tasks: MiseTask[],
	) {
		super(source, vscode.TreeItemCollapsibleState.Expanded);
		this.tooltip = `Source: ${source}\nTasks: ${tasks.length}`;
		this.iconPath = new vscode.ThemeIcon("folder");
	}
}

class TaskItem extends vscode.TreeItem {
	constructor(public readonly task: MiseTask) {
		super(task.name, vscode.TreeItemCollapsibleState.None);
		this.tooltip = `Task: ${task.name}\nSource: ${task.source}\nDescription: ${task.description}`;
		this.iconPath = new vscode.ThemeIcon("play");

		// Add command to run the task
		this.command = {
			title: "Run Task",
			command: "mise.runTask",
			arguments: [this],
		};
	}
}

// Register the command in your extension's activate function:
export function registerMiseCommands(
	context: vscode.ExtensionContext,
	taskProvider: MiseTasksProvider,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand("mise.runTask", (taskItem: TaskItem) => {
			taskProvider.runTask(taskItem);
		}),
	);
}
