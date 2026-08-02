import * as vscode from "vscode";
import { getMiseEnv, isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { buildShellCommand } from "../utils/shell";

/**
 * Task running mise with `args`. The arguments are quoted here rather than by
 * vscode: its own `ShellQuoting.Strong` wraps values in quotes without escaping
 * the quotes they contain, which a task name coming from a repository may hold.
 */
function createMiseExecution(
	miseBinaryPath: string,
	args: string[],
): vscode.ShellExecution {
	return new vscode.ShellExecution(buildShellCommand(miseBinaryPath, args));
}

// this allows to run VSCode tasks from the command palette
export class VsCodeTaskProvider {
	private readonly provider: vscode.Disposable;

	constructor(readonly miseService: MiseService) {
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

						const miseBinaryPath = miseService.getMiseBinaryPath();
						if (!miseBinaryPath) {
							return undefined;
						}

						const execution = createMiseExecution(
							miseBinaryPath,
							miseService.buildMiseArgs(["run", task.name]),
						);
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

					const runArgs: string[] = [];
					const allWatchArgs: string[] = [];
					const glob = task.definition.glob ?? "";
					const miseEnv = task.definition.miseEnv;

					if (miseEnv === undefined) {
						const miseEnvFromConfig = getMiseEnv();
						if (miseEnvFromConfig) {
							runArgs.push("--env", miseEnvFromConfig);
						}
					} else if (miseEnv) {
						runArgs.push("--env", miseEnv);
					}

					allWatchArgs.push(...runArgs);
					if (glob) {
						allWatchArgs.push(`--glob=${glob}`);
					}
					allWatchArgs.push(...watchexecArgs);
					if (args.length > 0) {
						runArgs.push("--", ...args);
					}

					const miseBinaryPath = miseService.getMiseBinaryPath();
					if (!miseBinaryPath) {
						return undefined;
					}

					const execution = createMiseExecution(
						miseBinaryPath,
						definition.watch
							? ["watch", "-t", definition.task, ...allWatchArgs]
							: ["run", definition.task, ...runArgs],
					);
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
