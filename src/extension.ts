import * as vscode from "vscode";
import {
	CONFIGURATION_FLAGS,
	getMiseProfile,
	isMiseExtensionEnabled,
} from "./configuration";
import { createMenu } from "./extensionMenu";
import { MiseFileWatcher } from "./miseFileWatcher";
import { MiseService } from "./miseService";
import {
	MiseEnvsProvider,
	registerEnvsCommands,
} from "./providers/envProvider";
import { MiseCompletionProvider } from "./providers/miseCompletionProvider";
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
import { VsCodeTaskProvider } from "./providers/vsCodeTaskProvider";
import { logger } from "./utils/logger";
import { resolveMisePath } from "./utils/miseBinLocator";
import { allowedFileTaskDirs } from "./utils/miseUtilts";
import { showSettingsNotification } from "./utils/notify";
import WebViewPanel from "./webviewPanel";

let statusBarItem: vscode.StatusBarItem;

async function initializeMisePath() {
	if (!isMiseExtensionEnabled()) {
		return;
	}

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
	statusBarItem.tooltip = "Mise - Command menu";

	registerTasksCommands(context, tasksProvider);
	registerToolsCommands(context, toolsProvider);
	registerEnvsCommands(context, miseService);

	vscode.window.registerTreeDataProvider("miseTasksView", tasksProvider);
	vscode.window.registerTreeDataProvider("miseToolsView", toolsProvider);
	vscode.window.registerTreeDataProvider("miseEnvsView", envsProvider);

	context.subscriptions.push(createMenu(miseService));

	statusBarItem.command = "mise.openMenu";
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);

	vscode.workspace.onDidChangeConfiguration((e) => {
		const miseConfigUpdated = Object.values(CONFIGURATION_FLAGS).some((flag) =>
			e.affectsConfiguration(flag),
		);

		if (miseConfigUpdated) {
			vscode.commands.executeCommand("mise.refreshEntry");
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.refreshEntry", async () => {
			await initializeMisePath();

			await vscode.commands.executeCommand(
				"workbench.view.extension.mise-panel",
			);

			statusBarItem.text = "$(sync~spin) Mise";
			try {
				if (isMiseExtensionEnabled()) {
					miseService.getCurrentTools().then(async (tools) => {
						const missingTools = tools.filter((tool) => !tool.installed);
						if (missingTools.length > 0) {
							const selection = await vscode.window.showWarningMessage(
								`Mise: Missing tools: ${missingTools
									.map(
										(tool) =>
											tool.name + (tool.version ? ` (${tool.version})` : ""),
									)
									.join(", ")}`,
								{ title: "Install missing tools", command: "mise.installAll" },
							);
							if (selection?.command) {
								await vscode.commands.executeCommand(selection.command);
							}
						}
					});
				}

				statusBarItem.text = "$(check) Mise";
				tasksProvider.refresh();
				toolsProvider.refresh();
				envsProvider.refresh();

				const autoConfigureSdks = vscode.workspace
					.getConfiguration("mise")
					.get("configureExtensionsAutomatically");
				if (autoConfigureSdks && isMiseExtensionEnabled()) {
					await vscode.commands.executeCommand("mise.configureAllSdkPaths");
				}

				statusBarItem.text = "$(tools) Mise";

				const miseProfile = getMiseProfile();
				if (miseProfile) {
					statusBarItem.text = `$(tools) Mise (${miseProfile})`;
				}
			} catch (error) {
				statusBarItem.text = "$(error) Mise";
				vscode.window.showErrorMessage(`${error}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "toml" },
			new MiseTomlCodeLensProvider(miseService),
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.openSettings", () => {
			vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"@ext:hverlin.mise-vscode",
			);
		}),
	);

	const rootFolder = vscode.workspace.workspaceFolders?.[0];
	if (rootFolder) {
		context.subscriptions.push(
			vscode.languages.registerCodeLensProvider(
				[
					{
						pattern: new vscode.RelativePattern(
							rootFolder,
							`{${allowedFileTaskDirs.map((dir) => `${dir}/**/*`)}}`,
						),
					},
					{ language: "shellscript" },
				],
				new MiseFileTaskCodeLensProvider(miseService),
			),
		);
	}

	context.subscriptions.push(new VsCodeTaskProvider(miseService).tasksProvider);

	const miseWatcher = new MiseFileWatcher(context, miseService, async (uri) => {
		logger.info(`Mise configuration file changed: ${uri}`);
		await vscode.commands.executeCommand("mise.refreshEntry");
	});
	context.subscriptions.push(miseWatcher);

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.listAllTools", async () => {
			WebViewPanel.createOrShow(context, miseService);
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ language: "toml", scheme: "file" },
			new MiseCompletionProvider(miseService),
			'"', // Trigger completion on quotes
			"'", // Trigger completion on quotes
			"[", // Trigger completion when opening array
			",", // Trigger completion after comma
		),
	);

	await vscode.commands.executeCommand("mise.refreshEntry");
}

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
