import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import type { MiseTaskInfo } from "../utils/taskInfoParser";

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

	private async collectArgumentValues(info: MiseTaskInfo): Promise<string[]> {
		const cmdArgs: string[] = [];
		const spec = info.usageSpec;

		// Collect positional arguments
		for (const arg of spec.args) {
			const value = await vscode.window.showInputBox({
				prompt: `Enter value for ${arg.name}`,
				placeHolder: arg.name,
				ignoreFocusOut: true,
				validateInput: (value) => {
					if (arg.required && !value) {
						return `${arg.name} is required`;
					}
					return null;
				},
			});

			if (value) {
				cmdArgs.push(value);
			} else if (arg.required) {
				throw new Error(`Required argument ${arg.name} was not provided`);
			}
		}

		// Collect flag/option values
		for (const flag of spec.flags) {
			if (flag.arg) {
				// This is an option (flag with value)
				const shouldProvide = await vscode.window.showQuickPick(["Yes", "No"], {
					placeHolder: `Do you want to provide ${flag.name}?`,
					ignoreFocusOut: true,
				});

				if (shouldProvide === "Yes") {
					const value = await vscode.window.showInputBox({
						prompt: `Enter value for ${flag.name}`,
						placeHolder: flag.arg,
						ignoreFocusOut: true,
					});

					if (value) {
						cmdArgs.push(flag.name, value);
					}
				}
			} else {
				// This is a boolean flag
				const shouldEnable = await vscode.window.showQuickPick(["Yes", "No"], {
					placeHolder: `Enable ${flag.name}?`,
					ignoreFocusOut: true,
				});

				if (shouldEnable === "Yes") {
					cmdArgs.push(flag.name);
				}
			}
		}

		return cmdArgs;
	}

	async runTask(taskName: string) {
		try {
			const taskInfo = await this.miseService.getTaskInfo(taskName);
			if (!taskInfo) {
				throw new Error(`Task '${taskName}' not found`);
			}

			// If task has arguments/flags, collect them
			if (
				taskInfo.usageSpec.args.length > 0 ||
				taskInfo.usageSpec.flags.length > 0
			) {
				const args = await this.collectArgumentValues(taskInfo);
				await this.miseService.runTask(taskName, ...args);
				vscode.window.showInformationMessage(
					`Task '${taskName}' started with arguments: ${args.join(" ")}`,
				);
			} else {
				await this.miseService.runTask(taskName);
				vscode.window.showInformationMessage(`Task '${taskName}' started`);
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to run task '${taskName}': ${error}`,
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

		this.command = {
			title: "Run Task",
			command: "mise.runTask",
			arguments: [this.task.name],
		};
	}
}

export const RUN_TASK_COMMAND = "mise.runTask";

export function registerMiseCommands(
	context: vscode.ExtensionContext,
	taskProvider: MiseTasksProvider,
) {
	context.subscriptions.push(
		vscode.commands.registerCommand(RUN_TASK_COMMAND, (taskName: string) => {
			taskProvider.runTask(taskName).catch((error) => {
				logger.error(`Failed to run task '${taskName}':`, error);
			});
		}),
	);
}
