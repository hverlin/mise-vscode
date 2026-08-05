import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	MISE_CLEAR_TASK_CACHE,
	MISE_CREATE_FILE_TASK,
	MISE_CREATE_TOML_TASK,
	MISE_CREATE_TOML_TASK_TOP_MENU,
	MISE_EXPLAIN_TASK_CACHE,
	MISE_GROUP_TASKS_BY_PROJECT,
	MISE_GROUP_TASKS_BY_SOURCE,
	MISE_OPEN_FILE,
	MISE_OPEN_TASK_DEFINITION,
	MISE_RUN_TASK,
	MISE_RUN_TASK_WITHOUT_CACHE,
	MISE_SEARCH_TASKS,
	MISE_SHOW_TASK_CACHE_MENU,
	MISE_WATCH_TASK,
} from "../commands";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	compareSourcePaths,
	displayPathRelativeTo,
	expandPath,
	getScriptFileExtension,
	setupMiseToml,
	setupTaskFile,
} from "../utils/fileUtils";
import { truncateStr } from "../utils/fn";
import { logger } from "../utils/logger";
import { findTaskDefinition } from "../utils/miseFileParser";
import {
	allowedFileTaskDirs,
	idiomaticFiles,
	renderDepsArray,
	UNPARSED_CONFIG_DESCRIPTION,
	UNPARSED_CONFIG_TOOLTIP,
} from "../utils/miseUtilts";
import { safeExec } from "../utils/shell";
import { formatCacheSummary } from "../utils/taskCache";
import { formatRunEntries, getTaskDescription } from "../utils/taskDisplay";
import type { MiseTaskInfo } from "../utils/taskInfoParser";
import {
	getTaskConfigRoot,
	getTaskDisplayName,
	getTaskProjectKey,
	getTaskProjectLabel,
	getTaskProjectRootPath,
} from "../utils/taskNames";
import { buildMiseErrorItems, type MiseErrorItem } from "./miseErrorItems";

export class MiseTasksProvider implements vscode.TreeDataProvider<TreeNode> {
	private _onDidChangeTreeData: vscode.EventEmitter<
		TreeNode | undefined | null | void
	> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<
		TreeNode | undefined | null | void
	> = this._onDidChangeTreeData.event;

	private grouping: TaskTreeGrouping = "source";
	private preferredGrouping: TaskTreeGrouping | undefined;
	private hasMultipleProjects = false;

	constructor(private miseService: MiseService) {}

	setGrouping(grouping: TaskTreeGrouping): void {
		if (grouping === "project" && !this.hasMultipleProjects) {
			return;
		}
		this.preferredGrouping = grouping;
		const effectiveGrouping = this.getEffectiveGrouping();
		if (this.grouping === effectiveGrouping) {
			return;
		}
		this.grouping = effectiveGrouping;
		this.updateGroupingContext();
		this.refresh();
	}

	private getEffectiveGrouping(): TaskTreeGrouping {
		return this.hasMultipleProjects
			? (this.preferredGrouping ?? "project")
			: "source";
	}

	private updateGroupingAvailability(tasks: MiseTask[]) {
		this.hasMultipleProjects = new Set(tasks.map(getTaskProjectKey)).size > 1;
		this.grouping = this.getEffectiveGrouping();
		this.updateGroupingContext();
	}

	private updateGroupingContext() {
		void vscode.commands.executeCommand(
			"setContext",
			"mise.tasksCanGroupByProject",
			this.hasMultipleProjects,
		);
		void vscode.commands.executeCommand(
			"setContext",
			"mise.tasksGroupByProject",
			this.hasMultipleProjects && this.grouping === "project",
		);
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	getMiseService(): MiseService {
		return this.miseService;
	}

	async getTasksSourceGroupItems() {
		const currentWorkspaceFolderPath =
			this.miseService.getCurrentWorkspaceFolderPath();

		const [tasks, configFiles] = await Promise.all([
			this.miseService.getTasks(),
			this.miseService.getMiseConfigFiles(),
		]);

		this.updateGroupingAvailability(tasks);
		const groupedTasks = this.groupTasks(tasks, currentWorkspaceFolderPath);
		// In project mode there is no unambiguous config file to create a task
		// in, so only source mode adds empty config-file groups.
		if (this.grouping === "source") {
			for (const configFile of configFiles) {
				if (idiomaticFiles.has(path.basename(configFile.path))) {
					continue;
				}

				// only offer empty groups for toml files (tasks can be created there)
				if (!configFile.path.endsWith(".toml")) {
					continue;
				}

				const expandedPath = expandPath(configFile.path);
				const isRelativeToWorkspace = expandedPath.startsWith(
					currentWorkspaceFolderPath || "",
				);
				if (!groupedTasks[expandedPath] && isRelativeToWorkspace) {
					groupedTasks[expandedPath] = [];
				}
			}
		}

		const projectRoot =
			this.grouping === "project" && currentWorkspaceFolderPath
				? expandPath(currentWorkspaceFolderPath)
				: undefined;
		const hasMonorepoRootGroup = Boolean(
			projectRoot &&
				groupedTasks[projectRoot]?.some(
					(task) => getTaskConfigRoot(task) === "",
				),
		);
		return Object.entries(groupedTasks)
			.sort(([sourceA], [sourceB]) => {
				// A project group is a directory, whereas source mode normally sorts
				// files within it. Give the monorepo-root directory an explicit rank.
				if (projectRoot && hasMonorepoRootGroup) {
					const isRootA = expandPath(sourceA) === projectRoot;
					const isRootB = expandPath(sourceB) === projectRoot;
					if (isRootA !== isRootB) {
						return isRootA ? -1 : 1;
					}
				}
				return compareSourcePaths(sourceA, sourceB, currentWorkspaceFolderPath);
			})
			.map(([source, tasks]) => {
				const isProjectGroup =
					this.grouping === "project" && Boolean(currentWorkspaceFolderPath);
				const projectLabel =
					isProjectGroup && tasks[0]
						? getTaskProjectLabel(tasks[0], currentWorkspaceFolderPath)
						: undefined;
				return new TasksSourceGroupItem(
					currentWorkspaceFolderPath || "",
					source,
					tasks,
					this.miseService.isConfigFileUnparsed(source),
					isProjectGroup,
					projectLabel,
				);
			});
	}

	async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		if (!element) {
			try {
				return await this.getTasksSourceGroupItems();
			} catch (e) {
				logger.info("Error while getting tasks tree items", e);
				vscode.commands.executeCommand(
					"setContext",
					"mise.tasksProviderError",
					true,
				);
				// say what mise said, with the actions that help for it
				return buildMiseErrorItems(e, "tasks");
			}
		}

		if (element instanceof TasksSourceGroupItem) {
			return Promise.all(
				element.tasks.map(
					async (task) => new TaskItem(task, await getFileTaskIconUri(task)),
				),
			);
		}

		return [];
	}

	async getTasksNames(): Promise<string[]> {
		const tasks = await this.miseService.getTasks();
		return tasks.map((task) => task.name);
	}

	async getTasks(): Promise<MiseTask[]> {
		return this.miseService.getTasks();
	}

	async getParent(element: TreeNode): Promise<TreeNode | undefined> {
		if (element instanceof TaskItem) {
			const source = getTaskGroupSource(
				element.task,
				this.grouping,
				this.miseService.getCurrentWorkspaceFolderPath(),
			);
			const groups = await this.getTasksSourceGroupItems();
			return groups.find((group) => group.source === source);
		}
		return undefined;
	}

	/** The tree item of a task, for `TreeView.reveal` (matched by id) */
	async findTaskItem(taskName: string): Promise<TaskItem | undefined> {
		const tasks = await this.miseService.getTasks();
		const task = tasks.find((t) => t.name === taskName);
		if (!task) {
			return undefined;
		}
		return new TaskItem(task, await getFileTaskIconUri(task));
	}

	private groupTasks(
		tasks: MiseTask[],
		currentWorkspaceFolderPath: string | undefined,
	): Record<string, MiseTask[]> {
		const groupedTasks: Record<string, MiseTask[]> = {};

		for (const task of tasks) {
			const source = getTaskGroupSource(
				task,
				this.grouping,
				currentWorkspaceFolderPath,
			);
			if (!groupedTasks[source]) {
				groupedTasks[source] = [];
			}
			groupedTasks[source].push(task);
		}
		return groupedTasks;
	}

	private async collectArgumentValues(
		info: MiseTaskInfo,
	): Promise<string[] | undefined> {
		const cmdArgs: string[] = [];
		const spec = info.usageSpec;

		// Collect positional arguments
		for (const arg of spec.args) {
			let value: string | undefined;
			if (arg.choices?.length) {
				value = await vscode.window.showQuickPick(arg.choices, {
					title: arg.required ? arg.name : `${arg.name} (optional)`,
					placeHolder: arg.help ?? `Select value for ${arg.name}`,
					ignoreFocusOut: true,
				});
			} else {
				value = await vscode.window.showInputBox({
					prompt: arg.help
						? `${arg.name}: ${arg.help}`
						: `Enter value for ${arg.name}`,
					placeHolder: arg.required ? arg.name : `${arg.name} (optional)`,
					value: arg.default,
					ignoreFocusOut: true,
					validateInput: (value) => {
						if (arg.required && !value) {
							return `${arg.name} is required`;
						}
						return null;
					},
				});
			}

			if (value === undefined && arg.required) {
				return undefined;
			}

			if (value) {
				cmdArgs.push(value);
			}
		}

		for (const flag of spec.flags) {
			const flagDescription = flag.help ? ` (${flag.help})` : "";
			if (flag.arg) {
				const shouldProvide = await vscode.window.showQuickPick(["Yes", "No"], {
					placeHolder: `Do you want to provide "${flag.name}" option?${flagDescription}`,
					ignoreFocusOut: true,
				});

				if (shouldProvide === undefined) {
					return undefined;
				}

				if (shouldProvide === "Yes") {
					let value: string | undefined;
					if (flag.choices?.length) {
						value = await vscode.window.showQuickPick(flag.choices, {
							title: flag.name,
							placeHolder: flag.help ?? `Select value for ${flag.name}`,
							ignoreFocusOut: true,
						});
					} else {
						value = await vscode.window.showInputBox({
							prompt: flag.help
								? `${flag.name}: ${flag.help}`
								: `Enter value for ${flag.name}=?`,
							placeHolder: flag.arg,
							value: flag.default,
							ignoreFocusOut: true,
						});
					}

					if (value === undefined) {
						return undefined;
					}

					if (value) {
						cmdArgs.push(flag.name, value);
					}
				}
			} else {
				const shouldEnable = await vscode.window.showQuickPick(["Yes", "No"], {
					placeHolder: `Enable ${flag.name}?${flagDescription}`,
					ignoreFocusOut: true,
				});

				if (shouldEnable === undefined) {
					return undefined;
				}

				if (shouldEnable === "Yes") {
					cmdArgs.push(flag.name);
				}
			}
		}

		return cmdArgs;
	}

	async runTask(
		taskName: string,
		{ runFlags = [] }: { runFlags?: string[] } = {},
	) {
		if (!(await this.miseService.confirmConfigParses(`run "${taskName}"`))) {
			return;
		}

		try {
			const taskInfo = await this.miseService.getTaskInfo(taskName);
			if (!taskInfo) {
				throw new Error(`Task '${taskName}' not found`);
			}

			if (
				taskInfo.usageSpec.args.length > 0 ||
				taskInfo.usageSpec.flags.length > 0
			) {
				const args = await this.collectArgumentValues(taskInfo);
				if (args === undefined) {
					return;
				}

				await this.miseService.runTask(taskName, { runFlags, args });
			} else {
				await this.miseService.runTask(taskName, { runFlags });
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to run task '${taskName}': ${error}`,
			);
		}
	}

	async watchTask(taskName: string) {
		if (!(await this.miseService.confirmConfigParses(`watch "${taskName}"`))) {
			return;
		}

		const [res1, res2] = await Promise.allSettled([
			this.miseService.getCurrentTools(),
			safeExec("which", ["watchexec"]),
		]);
		const tools = res1.status === "fulfilled" ? res1.value : [];
		const watchexecFromTools = tools.find(
			(tool) => tool.name === "watchexec" && tool.installed,
		);
		const watchexec =
			res2.status === "fulfilled" && res2.value.code === 0
				? res2.value.stdout.trim()
				: "";
		if (!watchexec && !watchexecFromTools) {
			vscode.window
				.showErrorMessage(
					"watchexec is required to run tasks in watch mode. Install it with `mise use -g watchexec`",
					"Install watchexec",
				)
				.then((selection) => {
					if (selection === "Install watchexec") {
						this.miseService.runMiseToolActionInConsole([
							"use",
							"-g",
							"watchexec",
						]);
					}
				});
			return;
		}

		try {
			const taskInfo = await this.miseService.getTaskInfo(taskName);
			if (!taskInfo) {
				throw new Error(`Task '${taskName}' not found`);
			}

			if (
				taskInfo.usageSpec.args.length > 0 ||
				taskInfo.usageSpec.flags.length > 0
			) {
				const args = await this.collectArgumentValues(taskInfo);
				if (args === undefined) {
					return;
				}
				await this.miseService.watchTask(taskName, ...args);
			} else {
				await this.miseService.watchTask(taskName);
			}
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to run task '${taskName}': ${error}`,
			);
		}
	}
}

type TreeNode = TasksSourceGroupItem | TaskItem | MiseErrorItem;
type TaskTreeGrouping = "source" | "project";

/** Key of the group a task is shown under in the tree */
function getTaskGroupSource(
	task: MiseTask,
	grouping: TaskTreeGrouping,
	currentWorkspaceFolderPath: string | undefined,
): string {
	const projectRoot =
		grouping === "project" && currentWorkspaceFolderPath
			? (getTaskProjectRootPath(task, currentWorkspaceFolderPath) ??
				getTaskProjectKey(task))
			: undefined;
	if (projectRoot) {
		return projectRoot;
	}

	return (
		(task.source.endsWith(".toml") || task.source.endsWith("package.json")
			? expandPath(task.source)
			: task.source.split("/").slice(0, -1).join("/")) || "Unknown"
	);
}

class TasksSourceGroupItem extends vscode.TreeItem {
	constructor(
		readonly currentWorkspaceFolderPath: string,
		public readonly source: string,
		public readonly tasks: MiseTask[],
		unparsed = false,
		readonly isProjectGroup = false,
		readonly projectLabel: string | undefined = undefined,
	) {
		const pathShown =
			projectLabel ?? displayPathRelativeTo(source, currentWorkspaceFolderPath);

		super(
			unparsed
				? pathShown
				: `${pathShown} (${tasks.length} ${tasks.length === 1 ? "task" : "tasks"})`,
		);
		// stable id so `TreeView.reveal` can match recreated items
		this.id = source;
		this.tooltip = unparsed
			? UNPARSED_CONFIG_TOOLTIP
			: projectLabel
				? `Project: ${projectLabel}`
				: `${isProjectGroup ? "Project" : "Source"}: ${source}`;
		if (unparsed) {
			this.description = UNPARSED_CONFIG_DESCRIPTION;
			this.iconPath = new vscode.ThemeIcon(
				"warning",
				new vscode.ThemeColor("list.warningForeground"),
			);
		}

		this.contextValue = isProjectGroup
			? "miseTaskProjectGroup"
			: source.endsWith(".toml")
				? "miseTaskGroupEditable"
				: "miseTaskGroup";

		if (tasks.length === 0) {
			this.collapsibleState = vscode.TreeItemCollapsibleState.None;
			this.iconPath = new vscode.ThemeIcon("chevron-right");
			this.command = {
				command: MISE_OPEN_FILE,
				title: "Open file",
				arguments: [this],
			};
		} else {
			this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
			this.resourceUri = vscode.Uri.file(source);
			// the "folder" id is resolved by the file icon theme, which may have
			// no folder icons; use a plain codicon for directories instead
			this.iconPath =
				!isProjectGroup &&
				(source.endsWith(".toml") || source.endsWith("package.json"))
					? vscode.ThemeIcon.File
					: new vscode.ThemeIcon("symbol-folder");
		}
	}
}

/**
 * Icon uri of a file task, reflecting the language of the script. The path can
 * be synthetic (`clean.sh` for a `clean` bash script), it is only used to pick
 * the icon of the icon theme.
 */
async function getFileTaskIconUri(
	task: MiseTask,
): Promise<vscode.Uri | undefined> {
	if (task.source.endsWith(".toml") || task.source.endsWith("package.json")) {
		return undefined;
	}
	const expandedSource = expandPath(task.source);
	const extension = await getScriptFileExtension(expandedSource);
	return extension
		? vscode.Uri.file(`${expandedSource}.${extension}`)
		: vscode.Uri.file(expandedSource);
}

class TaskItem extends vscode.TreeItem {
	constructor(
		public readonly task: MiseTask,
		fileTaskIconUri?: vscode.Uri,
	) {
		// the group already shows the source file, avoid repeating the qualifier
		super(getTaskDisplayName(task), vscode.TreeItemCollapsibleState.None);
		// stable id so `TreeView.reveal` can match recreated items
		this.id = `${task.source}:${task.name}`;
		const runInfo = formatRunEntries(task.run).join(" ");
		this.tooltip = [
			["Task", task.name],
			["Description", task.description],
			["Source", task.source],
			["Directory", task.dir],
			["Depends on", renderDepsArray(task.depends)],
			["Waits for", renderDepsArray(task.wait_for)],
			["Post-depends on", renderDepsArray(task.depends_post)],
			["Run", runInfo ? truncateStr(runInfo, 120) : ""],
		]
			.filter(([_, value]) => value)
			.map(([key, value]) => `${key}: ${value}`)
			.join("\n");

		this.description = getTaskDescription(task);

		if (fileTaskIconUri) {
			this.resourceUri = fileTaskIconUri;
			this.iconPath = vscode.ThemeIcon.File;
		} else {
			this.iconPath = new vscode.ThemeIcon("tasklist");
		}

		this.command = {
			command: MISE_OPEN_TASK_DEFINITION,
			title: "Open Task Definition",
			tooltip: `Open Task Definition ${task.name} in the editor`,
			arguments: [task],
		};

		this.contextValue = "miseTask";
	}
}

/**
 * Commands are invoked from the palette (no argument), the tasks view (a
 * `TaskItem`), a code lens (a task name) or a hover (a `MiseTask`).
 */
function taskNameFromArgument(
	taskName: undefined | string | MiseTask | TaskItem,
): string | undefined {
	if (!taskName) {
		return undefined;
	}
	if (typeof taskName === "string") {
		return taskName;
	}
	return taskName instanceof TaskItem ? taskName.task.name : taskName.name;
}

/** Ask the user to pick a task, listing every task with its description */
async function pickTaskName(
	taskProvider: MiseTasksProvider,
	placeHolder: string,
): Promise<string | undefined> {
	const tasks = await taskProvider.getTasks();
	const workspaceRoot = taskProvider
		.getMiseService()
		.getCurrentWorkspaceFolderPath();
	const picked = await vscode.window.showQuickPick(
		tasks.map((task) => ({
			label: task.name,
			// a flat list has no group header to locate a file task, so its
			// script stands in when nothing else describes it
			description:
				getTaskDescription(task) ||
				(task.file ? displayPathRelativeTo(task.file, workspaceRoot) : ""),
		})),
		{ placeHolder, matchOnDescription: true },
	);
	return picked?.label;
}

/** Task name from a command argument, asking the user when there is none */
async function resolveTaskName(
	taskProvider: MiseTasksProvider,
	taskName: undefined | string | MiseTask | TaskItem,
	placeHolder: string,
): Promise<string | undefined> {
	return (
		taskNameFromArgument(taskName) ??
		(await vscode.window.showQuickPick(taskProvider.getTasksNames(), {
			placeHolder,
		}))
	);
}

export function registerTasksCommands(
	context: vscode.ExtensionContext,
	taskProvider: MiseTasksProvider,
	tasksTreeView?: vscode.TreeView<TreeNode>,
) {
	const miseService = taskProvider.getMiseService();
	// Match the dependency graph's in-memory view controls: source grouping is
	// restored whenever the extension is activated.
	void vscode.commands.executeCommand(
		"setContext",
		"mise.tasksCanGroupByProject",
		false,
	);
	void vscode.commands.executeCommand(
		"setContext",
		"mise.tasksGroupByProject",
		false,
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_GROUP_TASKS_BY_PROJECT, () => {
			taskProvider.setGrouping("project");
		}),
		vscode.commands.registerCommand(MISE_GROUP_TASKS_BY_SOURCE, () => {
			taskProvider.setGrouping("source");
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			MISE_RUN_TASK,
			async (taskName: undefined | string | MiseTask | TaskItem) => {
				await vscode.workspace.saveAll(false);

				let name = taskName;
				if (!name) {
					name = await pickTaskName(taskProvider, "Select a task to run");
					if (!name) {
						return;
					}
				}

				if (typeof name !== "string") {
					name = name instanceof TaskItem ? name.task.name : (name?.name ?? "");
				}
				taskProvider.runTask(name).catch((error) => {
					logger.error(`Failed to run task '${taskName}':`, error);
				});
			},
		),
		// search icon in the tasks view title: select the picked task in the
		// panel and open its definition (without running it)
		vscode.commands.registerCommand(MISE_SEARCH_TASKS, async () => {
			const taskName = await pickTaskName(taskProvider, "Search for a task");
			if (!taskName) {
				return;
			}

			const taskItem = await taskProvider.findTaskItem(taskName);
			if (!taskItem) {
				return;
			}

			if (tasksTreeView) {
				try {
					await tasksTreeView.reveal(taskItem, { select: true, expand: true });
				} catch (error) {
					logger.info("Could not reveal the task in the panel", error as Error);
				}
			}
			await vscode.commands.executeCommand(
				MISE_OPEN_TASK_DEFINITION,
				taskItem.task,
			);
		}),
		vscode.commands.registerCommand(
			MISE_WATCH_TASK,
			async (taskName: undefined | string | MiseTask | TaskItem) => {
				await vscode.workspace.saveAll(false);

				let name = taskName;
				if (!name) {
					name = await pickTaskName(taskProvider, "Select a task to watch");
				}

				if (typeof name !== "string") {
					name = name instanceof TaskItem ? name.task.name : (name?.name ?? "");
				}
				taskProvider.watchTask(name).catch((error) => {
					logger.error(`Failed to run task (watch mode) '${taskName}':`, error);
				});
			},
		),
		vscode.commands.registerCommand(
			MISE_RUN_TASK_WITHOUT_CACHE,
			async (taskName: undefined | string | MiseTask | TaskItem) => {
				const name = await resolveTaskName(
					taskProvider,
					taskName,
					"Select a task to run without its output cache",
				);
				if (!name) {
					return;
				}

				await vscode.workspace.saveAll(false);
				await taskProvider
					.runTask(name, { runFlags: ["--task-cache", "off"] })
					.catch((error) => {
						logger.error(`Failed to run task '${name}' without cache:`, error);
					});
			},
		),
		vscode.commands.registerCommand(
			MISE_EXPLAIN_TASK_CACHE,
			async (taskName: undefined | string | MiseTask | TaskItem) => {
				const name = await resolveTaskName(
					taskProvider,
					taskName,
					"Select a task to explain the cache key of",
				);
				if (!name) {
					return;
				}

				// --dry-run keeps the task itself (and its command inputs) from running
				await miseService.runTask(name, {
					runFlags: ["--dry-run", "--task-cache-explain"],
				});
			},
		),
		vscode.commands.registerCommand(
			MISE_CLEAR_TASK_CACHE,
			async (taskName: undefined | string | MiseTask | TaskItem) => {
				let name = taskNameFromArgument(taskName);
				if (!name) {
					const cacheInfo = await miseService.getTaskCacheInfo();
					const cachedTasks = cacheInfo.filter(
						(info) => info.entries.length > 0,
					);
					if (cachedTasks.length === 0) {
						vscode.window.showInformationMessage(
							"No task has cached results to clear.",
						);
						return;
					}

					const picked = await vscode.window.showQuickPick(
						cachedTasks.map((info) => ({
							label: info.task,
							description: formatCacheSummary(info.entries),
						})),
						{ placeHolder: "Select a task to clear the output cache of" },
					);
					name = picked?.label;
				}

				if (!name) {
					return;
				}

				await miseService.clearTaskCacheInConsole(name);
			},
		),
		vscode.commands.registerCommand(
			MISE_SHOW_TASK_CACHE_MENU,
			async (taskName: undefined | string | MiseTask | TaskItem) => {
				const name = await resolveTaskName(
					taskProvider,
					taskName,
					"Select a task to inspect the output cache of",
				);
				if (!name) {
					return;
				}

				const entries = await miseService.getTaskCacheEntries(name);
				const actions: Array<vscode.QuickPickItem & { command: string }> = [
					{
						label: "$(list-tree) Explain cache key",
						description: "mise run --dry-run --task-cache-explain",
						command: MISE_EXPLAIN_TASK_CACHE,
					},
					{
						label: "$(debug-restart) Run without cache",
						description: "mise run --task-cache off",
						command: MISE_RUN_TASK_WITHOUT_CACHE,
					},
				];
				if (entries.length > 0) {
					actions.push({
						label: "$(trash) Clear cache",
						description: `mise cache clear --task (${formatCacheSummary(entries)})`,
						command: MISE_CLEAR_TASK_CACHE,
					});
				}

				const picked = await vscode.window.showQuickPick(actions, {
					placeHolder: `Task cache: ${name} (${formatCacheSummary(entries)})`,
				});
				if (!picked) {
					return;
				}

				await vscode.commands.executeCommand(picked.command, name);
			},
		),
		vscode.commands.registerCommand(
			MISE_OPEN_TASK_DEFINITION,
			async (task: MiseTask | undefined) => {
				let selectedTask = task;
				if (!selectedTask) {
					const tasks = await taskProvider.getTasksNames();
					const taskName = await vscode.window.showQuickPick(tasks, {
						placeHolder: "Select a task to open",
					});
					selectedTask = (await taskProvider.getTasks()).find(
						(t) => t.name === taskName,
					);
				}

				if (!selectedTask?.source) {
					return;
				}

				const uri = vscode.Uri.file(
					selectedTask.source.replace(/^~/, os.homedir()),
				);
				const document = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(document);

				const position = findTaskDefinition(document, selectedTask.name);
				if (position) {
					if (position.start.isEqual(position.end)) {
						editor.selection = new vscode.Selection(
							position.start,
							position.start,
						);
						editor.revealRange(
							new vscode.Range(position.start, position.start),
						);
					} else {
						const startOfLine = new vscode.Position(position.start.line, 0);
						const range = document.lineAt(position.start.line).range;
						const selection = new vscode.Selection(startOfLine, range.end);
						editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
						editor.selection = selection;
					}
				} else {
					vscode.window.showWarningMessage(
						`Could not locate task "${selectedTask.name}" in ${document.fileName}`,
					);
				}
			},
		),
		vscode.commands.registerCommand(MISE_CREATE_FILE_TASK, async () => {
			const taskName = await vscode.window.showInputBox({
				prompt: "Enter the name of the task",
				placeHolder: "task_name",
				validateInput: (value) => {
					if (!value) {
						return "Task name is required";
					}
					if (value.split(/[\\/]/).some((part) => part === "..")) {
						return "Task name cannot navigate out of the task directory";
					}
					if (path.isAbsolute(value)) {
						return "Task name must be relative to the task directory";
					}
					return null;
				},
			});

			if (!taskName) {
				return;
			}

			const taskSource = await vscode.window.showQuickPick(
				allowedFileTaskDirs,
				{
					title: "Select the task source directory",
					placeHolder: "Select the task source directory",
				},
			);

			if (!taskSource) {
				return;
			}
			if (!allowedFileTaskDirs.includes(taskSource)) {
				vscode.window.showErrorMessage(
					`Invalid task source directory: ${taskSource}`,
				);
				return;
			}

			const rootPath = miseService.getCurrentWorkspaceFolderPath();
			const taskDir = path.join(rootPath ?? "", taskSource);
			const taskFile = vscode.Uri.file(`${taskDir}/${taskName}`);

			await setupTaskFile(taskFile.fsPath, taskDir);

			const document = await vscode.workspace.openTextDocument(taskFile);
			const editor = await vscode.window.showTextDocument(document);

			const taskDefinition = [
				"#!/usr/bin/env bash",
				`#MISE description="Run ${taskName}"`,
				'#USAGE flag "-v --verbose" help="Enable verbose output"',
				'#USAGE arg "[something]" help="What to print in verbose mode" default="hello"',
				'#USAGE complete "something" run="ls"',
				"",
				`echo "Running ${taskName}"`,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable
				'if [[ "${usage_verbose:-}" == "true" ]]; then',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable
				'  echo "${usage_something}"',
				"fi",
				"",
				"# See https://mise.jdx.dev/tasks/file-tasks.html for more information",
				"# and https://mise.jdx.dev/tasks/task-arguments.html for task arguments",
			].join("\n");

			await editor.edit((edit) => {
				edit.insert(new vscode.Position(0, 0), taskDefinition);
			});
			await editor.document.save();
			await vscode.commands.executeCommand("workbench.action.files.save");
			taskProvider.refresh();
		}),
		vscode.commands.registerCommand(
			MISE_CREATE_TOML_TASK_TOP_MENU,
			async () => {
				vscode.commands.executeCommand(MISE_CREATE_TOML_TASK);
			},
		),
		vscode.commands.registerCommand(
			MISE_CREATE_TOML_TASK,
			async (path: string | TasksSourceGroupItem | undefined) => {
				let selectedPath = path;
				if (!selectedPath) {
					const miseConfigFiles =
						await miseService.getMiseTomlConfigFilePathsEvenIfMissing();
					selectedPath = await vscode.window.showQuickPick(miseConfigFiles, {
						placeHolder: "Select a configuration file",
					});
				} else if (selectedPath instanceof TasksSourceGroupItem) {
					selectedPath = selectedPath.source;
				}

				if (!selectedPath) {
					return;
				}

				const uri = vscode.Uri.file(selectedPath);

				await setupMiseToml(uri.fsPath);

				const document = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(document);

				const taskName = await vscode.window.showInputBox({
					prompt: "Enter the name of the task",
					placeHolder: "task_name",
					validateInput: (value) => {
						if (!value) {
							return "Task name is required";
						}
						return null;
					},
				});

				if (!taskName) {
					return;
				}

				editor.edit((edit) => {
					edit.insert(
						new vscode.Position(document.lineCount, 0),
						`\n[tasks.${taskName}]\nrun = "echo 'Running ${taskName}'"`,
					);
				});
			},
		),
	);
}
