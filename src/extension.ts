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
import { VsCodeTaskProvider } from "./providers/vsCodeTaskProvider";
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
	statusBarItem.tooltip = "Mise - Command menu";

	registerTasksCommands(context, tasksProvider);
	registerToolsCommands(context, toolsProvider);
	registerEnvsCommands(context, miseService);

	vscode.window.registerTreeDataProvider("miseTasksView", tasksProvider);
	vscode.window.registerTreeDataProvider("miseToolsView", toolsProvider);
	vscode.window.registerTreeDataProvider("miseEnvsView", envsProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.openMenu", async () => {
			const miseVersion = await miseService.getVersion();

			const pick = await vscode.window.showQuickPick(
				[
					{ label: "Mise version", detail: miseVersion },
					{
						iconPath: new vscode.ThemeIcon("refresh"),
						label: "Reload configuration",
						detail: "Reload Mise configuration",
					},
					{ label: "", kind: vscode.QuickPickItemKind.Separator },
					{
						iconPath: new vscode.ThemeIcon("gear"),
						label: "Open Mise settings",
					},
					{
						iconPath: new vscode.ThemeIcon("info"),
						label: "About vscode-mise",
					},
				],
				{ title: "Mise - Command menu" },
			);

			switch (pick?.label) {
				case "Reload configuration":
					await vscode.commands.executeCommand("mise.refreshEntry");
					break;
				case "Settings":
					await vscode.commands.executeCommand("mise.openSettings");
					break;
				case "About vscode-mise":
					vscode.env.openExternal(
						vscode.Uri.parse("https://github.com/hverlin/mise-vscode"),
					);
					break;
				default:
					break;
			}
		}),
	);

	statusBarItem.command = "mise.openMenu";
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
			await initializeMisePath();

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
				vscode.window.showErrorMessage(`${error}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "toml", pattern: "**/*mise*.toml" },
			new MiseTomlCodeLensProvider(),
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

	context.subscriptions.push(new VsCodeTaskProvider(miseService).tasksProvider);

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
