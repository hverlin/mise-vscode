import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";

// this allows to run VSCode tasks from the command palette
export class VsCodeTaskProvider {
	private readonly provider: vscode.Disposable;

	constructor(private readonly miseService: MiseService) {
		this.provider = vscode.tasks.registerTaskProvider("mise", {
			provideTasks: async () => {
				if (!isMiseExtensionEnabled()) {
					return;
				}

				const tasks = await miseService.getTasks();
				return tasks
					.map((task) => {
						const taskDefinition: vscode.TaskDefinition = {
							type: "mise",
							task: task.name,
							runArgs: [],
							watch: false,
							watchexecArgs: [],
						};

						const baseCommand = miseService.createMiseCommand(
							`run ${task.name}`,
						);

						if (!baseCommand) {
							return undefined;
						}

						const execution = new vscode.ShellExecution(baseCommand);
						return new vscode.Task(
							taskDefinition,
							vscode.TaskScope.Workspace,
							task.name,
							"mise",
							execution,
						);
					})
					.filter((task) => task !== undefined);
			},
			resolveTask(task: vscode.Task): vscode.Task | undefined {
				if (task.definition.type === "mise") {
					const definition = task.definition;
					const args = task.definition.runArgs ?? [];
					const watchexecArgs = task.definition.watchexecArgs ?? [];

					const runArgs = [];
					const allWatchArgs = [];
					const glob = task.definition.glob ?? "";
					const profile = task.definition.profile;

					if (profile === undefined) {
						const profileFromConfig = vscode.workspace
							.getConfiguration("mise")
							.get("profile");
						if (profileFromConfig) {
							runArgs.push(`--profile=${profileFromConfig}`);
						}
					} else if (profile) {
						runArgs.push(`--profile=${profile}`);
					}

					allWatchArgs.push(...runArgs);
					if (glob) {
						allWatchArgs.push(`--glob=${glob}`);
					}
					allWatchArgs.push(...watchexecArgs);
					runArgs.push("--", ...args);

					const baseCommand = miseService.createMiseCommand(
						definition.watch
							? `watch -t "${definition.task.replace(/"/g, '\\"')}" ${allWatchArgs.join(" ")}`
							: `run ${definition.task} ${runArgs.join(" ")}`,
						{ setProfile: false },
					);

					if (!baseCommand) {
						return undefined;
					}

					const execution = new vscode.ShellExecution(baseCommand);
					return new vscode.Task(
						definition,
						task.scope ?? vscode.TaskScope.Workspace,
						task.name,
						"mise",
						execution,
					);
				}
				return undefined;
			},
		});
	}

	get tasksProvider() {
		return this.provider;
	}
}
