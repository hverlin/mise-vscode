import { createCache } from "async-cache-dedupe";
import * as vscode from "vscode";
import { MarkdownString } from "vscode";
import {
	CONFIGURATION_FLAGS,
	MISE_OPEN_FILE,
	getMiseProfile,
	getRootFolder,
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
import { showToolVersionInline } from "./providers/miseToolCompletionProvider";
import { registerTomlFileLinks } from "./providers/taskIncludesNavigation";
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

export async function activate(context: vscode.ExtensionContext) {
	const miseService = new MiseService();
	await miseService.initializeMisePath();

	const tasksProvider = new MiseTasksProvider(miseService);
	const toolsProvider = new MiseToolsProvider(miseService);
	const envsProvider = new MiseEnvsProvider(miseService);

	statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBarItem.show();
	statusBarItem.text = "$(tools) Mise";
	statusBarItem.tooltip = new MarkdownString(
		`Mise - click to open menu\n\nVersion: ${await miseService.getVersion()}\n\nBinPath: ${miseService.getMiseBinaryPath()}`,
	);

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

	const globalCmdCache = createCache({
		ttl: 1,
	}).define("reload", async () => {
		logger.info("Reloading Mise configuration");
		await miseService.initializeMisePath();
		await vscode.commands.executeCommand("workbench.view.extension.mise-panel");

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
	});

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.refreshEntry", async () => {
			await globalCmdCache.reload();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			MISE_OPEN_FILE,
			async (uri: string | undefined | { source: string }) => {
				let selectedUri = uri;
				if (!selectedUri) {
					const miseConfigFiles = await miseService.getMiseConfigFiles();
					selectedUri = await vscode.window.showQuickPick(
						miseConfigFiles.map((file) => file.path),
						{ placeHolder: "Select a configuration file" },
					);
				} else if ((selectedUri as { source: string })?.source) {
					selectedUri = (selectedUri as { source: string }).source;
				}

				if (!selectedUri) {
					return;
				}
				const path = selectedUri as string;
				vscode.window.showTextDocument(vscode.Uri.file(path));
			},
		),
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

	context.subscriptions.push(
		vscode.commands.registerCommand("mise.openLogs", async () => {
			logger.show();
		}),
	);

	const rootFolder = getRootFolder();
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
			'"',
			"'",
			"[",
			",",
		),
	);

	registerTomlFileLinks(context);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (
				event.document === vscode.window.activeTextEditor?.document &&
				event.document.languageId === "toml"
			) {
				showToolVersionInline(event.document, miseService);
			}
		}),
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor && editor.document.languageId === "toml") {
				showToolVersionInline(editor.document, miseService);
			}
		}),
	);

	if (vscode.window.activeTextEditor?.document.languageId === "toml") {
		void showToolVersionInline(
			vscode.window.activeTextEditor?.document,
			miseService,
		);
	}

	await vscode.commands.executeCommand("mise.refreshEntry");

	setTimeout(async () => {
		void miseService.checkNewMiseVersion();
	}, 1000);
}

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
