import * as vscode from "vscode";
import { MiseFileWatcher } from "./miseFileWatcher";
import { MiseService } from "./miseService";
import {
	MiseEnvsProvider,
	registerEnvsCommands,
} from "./providers/envProvider";
import { MiseFileTaskCodeLensProvider } from "./providers/miseFileTaskCodeLensProvider";
import { MiseTomlCodeLensProvider } from "./providers/miseTomlCodeLensProvider";
import {
	MiseTasksProvider,
	registerTasksCommands,
} from "./providers/tasksProvider";
import {
	MiseToolsProvider,
	registerToolsCommands,
} from "./providers/toolsProvider";
import { logger } from "./utils/logger";
import { resolveMisePath } from "./utils/miseBinLocator";
import { allowedFileTaskDirs } from "./utils/miseUtilts";
import { showSettingsNotification } from "./utils/notify";

let statusBarItem: vscode.StatusBarItem;

async function initializeMisePath() {
	let miseBinaryPath = "mise";
	try {
		miseBinaryPath = await resolveMisePath();
		logger.info(`Mise binary path resolved to: ${miseBinaryPath}`);
		const config = vscode.workspace.getConfiguration("mise");
		const previousPath = config.get<string>("binPath");
		if (previousPath !== miseBinaryPath) {
			config.update(
				"binPath",
				miseBinaryPath,
				vscode.ConfigurationTarget.Global,
			);
			void showSettingsNotification(
				`Mise binary path has been updated to: ${miseBinaryPath}`,
				{ settingsKey: "mise.binPath", type: "info" },
			);
		}
	} catch (error) {
		void showSettingsNotification(
			"Mise binary not found. Please configure the binary path.",
			{ settingsKey: "mise.binPath", type: "error" },
		);
		logger.info(
			`Failed to resolve mise binary path: ${error instanceof Error ? error?.message : String(error)}`,
		);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	await initializeMisePath();
	const miseService = new MiseService();

	const tasksProvider = new MiseTasksProvider(miseService);
	const toolsProvider = new MiseToolsProvider(miseService);
	const envsProvider = new MiseEnvsProvider(miseService);

	statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBarItem.show();
	statusBarItem.text = "$(tools) Mise";
	statusBarItem.tooltip = "Click to refresh Mise";

	registerTasksCommands(context, tasksProvider);
	registerToolsCommands(context, toolsProvider);
	registerEnvsCommands(context, miseService);

	vscode.window.registerTreeDataProvider("miseTasksView", tasksProvider);
	vscode.window.registerTreeDataProvider("miseToolsView", toolsProvider);
	vscode.window.registerTreeDataProvider("miseEnvsView", envsProvider);

	statusBarItem.command = "mise.refreshEntry";
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);

	vscode.workspace.onDidChangeConfiguration((e) => {
		if (
			e.affectsConfiguration("mise.binPath") ||
			e.affectsConfiguration("mise.profile") ||
			e.affectsConfiguration("mise.configureExtensionsAutomatically") ||
			e.affectsConfiguration("mise.configureExtensionsUseShims")
		) {
			vscode.commands.executeCommand("mise.refreshEntry");
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.refreshEntry", async () => {
			const miseProfile = vscode.workspace
				.getConfiguration("mise")
				.get("profile");

			await vscode.commands.executeCommand(
				"workbench.view.extension.mise-panel",
			);

			statusBarItem.text = "$(sync~spin) Mise";
			try {
				statusBarItem.text = "$(check) Mise";
				tasksProvider.refresh();
				toolsProvider.refresh();
				envsProvider.refresh();
				const autoConfigureSdks = vscode.workspace
					.getConfiguration("mise")
					.get("configureExtensionsAutomatically");
				if (autoConfigureSdks) {
					await vscode.commands.executeCommand("mise.configureAllSdkPaths");
				}
				statusBarItem.text = "$(tools) Mise";
				if (miseProfile) {
					statusBarItem.text = `$(tools) Mise (${miseProfile})`;
				}
			} catch (error) {
				statusBarItem.text = "$(error) Mise";
				vscode.window.showErrorMessage(
					`Failed to refresh Mise views: ${error}`,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "toml", pattern: "**/*mise*.toml" },
			new MiseTomlCodeLensProvider(),
		),
	);

	const rootFolder = vscode.workspace.workspaceFolders?.[0];
	if (rootFolder) {
		context.subscriptions.push(
			vscode.languages.registerCodeLensProvider(
				{
					pattern: new vscode.RelativePattern(
						rootFolder,
						`{${allowedFileTaskDirs.map((dir) => `${dir}/**/*`)}}`,
					),
				},
				new MiseFileTaskCodeLensProvider(),
			),
		);
	}

	const taskProvider = vscode.tasks.registerTaskProvider("mise", {
		provideTasks: async () => {
			const tasks = await miseService.getTasks();
			return tasks
				.map((task) => {
					const taskDefinition: vscode.TaskDefinition = {
						type: "mise",
						task: task.name,
					};

					const baseCommand = miseService.createMiseCommand(`run ${task.name}`);
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
		resolveTask(_task: vscode.Task): vscode.Task | undefined {
			return undefined;
		},
	});

	context.subscriptions.push(taskProvider);

	const miseWatcher = new MiseFileWatcher(context, miseService, async (uri) => {
		logger.info(`Mise configuration file changed: ${uri}`);
		await vscode.commands.executeCommand("mise.refreshEntry");
	});
	context.subscriptions.push(miseWatcher);

	await vscode.commands.executeCommand("mise.refreshEntry");
}

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
