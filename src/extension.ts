import { createCache } from "async-cache-dedupe";
import * as vscode from "vscode";
import { MarkdownString } from "vscode";
import {
	MISE_CONFIGURE_ALL_SKD_PATHS,
	MISE_INSTALL_ALL,
	MISE_LIST_ALL_TOOLS,
	MISE_OPEN_EXTENSION_SETTINGS,
	MISE_OPEN_FILE,
	MISE_OPEN_LOGS,
	MISE_OPEN_MENU,
	MISE_RELOAD,
	MISE_SHOW_SETTINGS,
	MISE_SHOW_TRACKED_CONFIG,
} from "./commands";
import {
	CONFIGURATION_FLAGS,
	getMiseEnv,
	getRootFolder,
	isMiseExtensionEnabled,
	shouldConfigureExtensionsAutomatically,
} from "./configuration";
import { createMenu } from "./extensionMenu";
import { MiseFileWatcher } from "./miseFileWatcher";
import { MiseService } from "./miseService";
import {
	MiseEnvsProvider,
	registerEnvsCommands,
	updateEnv,
} from "./providers/envProvider";
import { MiseCompletionProvider } from "./providers/miseCompletionProvider";
import { MiseFileTaskCodeLensProvider } from "./providers/miseFileTaskCodeLensProvider";
import {
	TeraCompletionProvider,
	createHoverProvider,
} from "./providers/miseTeraCompletionProvider";
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
import { allowedFileTaskDirs } from "./utils/miseUtilts";
import WebViewPanel from "./webviewPanel";

export async function activate(context: vscode.ExtensionContext) {
	const miseService = new MiseService();
	await miseService.initializeMisePath();

	const tasksProvider = new MiseTasksProvider(miseService);
	const toolsProvider = new MiseToolsProvider(miseService);
	const envsProvider = new MiseEnvsProvider(miseService);

	const statusBarItem = vscode.window.createStatusBarItem(
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

	statusBarItem.command = MISE_OPEN_MENU;
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);

	vscode.workspace.onDidChangeConfiguration((e) => {
		const miseConfigUpdated = Object.values(CONFIGURATION_FLAGS).some((flag) =>
			e.affectsConfiguration(`mise.${flag}`),
		);

		if (miseConfigUpdated) {
			vscode.commands.executeCommand(MISE_RELOAD);
		}
	});

	vscode.extensions.onDidChange(() => {
		if (isMiseExtensionEnabled()) {
			vscode.commands.executeCommand(MISE_RELOAD);
		}
	});

	const globalCmdCache = createCache({
		ttl: 1,
	}).define("reload", async () => {
		logger.info("Reloading Mise configuration");
		await miseService.invalidateCache();
		await miseService.initializeMisePath();

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
							{ title: "Install missing tools", command: MISE_INSTALL_ALL },
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

			updateEnv(context, miseService).catch((error) => {
				logger.error(`Error while updating environment: ${error}`);
			});

			if (
				shouldConfigureExtensionsAutomatically() &&
				isMiseExtensionEnabled()
			) {
				await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SKD_PATHS);
			}

			statusBarItem.text = "$(tools) Mise";
			const miseEnv = getMiseEnv();
			if (miseEnv) {
				statusBarItem.text = `$(tools) Mise (${miseEnv})`;
			}
		} catch (error) {
			statusBarItem.text = "$(error) Mise";
			vscode.window.showErrorMessage(`${error}`);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_RELOAD, async () => {
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
		vscode.commands.registerCommand(MISE_OPEN_EXTENSION_SETTINGS, () => {
			vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"@ext:hverlin.mise-vscode",
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_OPEN_LOGS, async () => {
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
		await vscode.commands.executeCommand(MISE_RELOAD);
	});
	context.subscriptions.push(miseWatcher);

	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_LIST_ALL_TOOLS, async () => {
			WebViewPanel.createOrShow(context, miseService, "TOOLS");
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_SHOW_SETTINGS, async () => {
			WebViewPanel.createOrShow(context, miseService, "SETTINGS");
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(MISE_SHOW_TRACKED_CONFIG, async () => {
			WebViewPanel.createOrShow(context, miseService, "TRACKED_CONFIGS");
		}),
	);

	const allTomlFilesSelector = { scheme: "file", language: "toml" };

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			allTomlFilesSelector,
			new MiseCompletionProvider(miseService),
			...['"', "'", "[", ","],
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

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			allTomlFilesSelector,
			new TeraCompletionProvider(),
			...["{", "%", "|", "."],
		),
	);
	context.subscriptions.push(createHoverProvider(allTomlFilesSelector));

	await vscode.commands.executeCommand(MISE_RELOAD);

	setTimeout(async () => {
		void miseService.checkNewMiseVersion();
	}, 1000);
}
