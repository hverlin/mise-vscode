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
	shouldAutomaticallyTrustMiseConfigFiles,
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

class MiseExtension {
	private miseService: MiseService = new MiseService();
	private statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);

	async activate(context: vscode.ExtensionContext) {
		this.statusBarItem.show();
		this.statusBarItem.text = "$(tools) Mise";

		context.subscriptions.push(createMenu(this.miseService));
		this.statusBarItem.command = MISE_OPEN_MENU;
		context.subscriptions.push(this.statusBarItem);

		await this.miseService.initializeMisePath();

		if (
			isMiseExtensionEnabled() &&
			shouldAutomaticallyTrustMiseConfigFiles() &&
			vscode.workspace.isTrusted
		) {
			await this.miseService.miseTrust();
		}

		const tasksProvider = new MiseTasksProvider(this.miseService);
		const toolsProvider = new MiseToolsProvider(this.miseService);
		const envsProvider = new MiseEnvsProvider(this.miseService);

		registerTasksCommands(context, tasksProvider);
		registerToolsCommands(context, toolsProvider);
		registerEnvsCommands(context, this.miseService);

		vscode.window.registerTreeDataProvider("miseTasksView", tasksProvider);
		vscode.window.registerTreeDataProvider("miseToolsView", toolsProvider);
		vscode.window.registerTreeDataProvider("miseEnvsView", envsProvider);

		vscode.workspace.onDidChangeConfiguration((e) => {
			const miseConfigUpdated = Object.values(CONFIGURATION_FLAGS).some(
				(flag) => e.affectsConfiguration(`mise.${flag}`),
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
			await this.miseService.invalidateCache();
			await this.miseService.initializeMisePath();

			this.statusBarItem.text = "$(sync~spin) Mise";
			try {
				if (isMiseExtensionEnabled()) {
					this.miseService.getCurrentTools().then(async (tools) => {
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

				this.statusBarItem.text = "$(check) Mise";
				tasksProvider.refresh();
				toolsProvider.refresh();
				envsProvider.refresh();

				updateEnv(context, this.miseService).catch((error) => {
					logger.error(`Error while updating environment: ${error}`);
				});

				if (
					shouldConfigureExtensionsAutomatically() &&
					isMiseExtensionEnabled()
				) {
					await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SKD_PATHS);
				}

				this.statusBarItem.text = "$(tools) Mise";
				const miseEnv = getMiseEnv();
				if (miseEnv) {
					this.statusBarItem.text = `$(tools) Mise (${miseEnv})`;
				}
			} catch (error) {
				this.statusBarItem.text = "$(error) Mise";
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
						const miseConfigFiles = await this.miseService.getMiseConfigFiles();
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
				new MiseTomlCodeLensProvider(this.miseService),
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
					new MiseFileTaskCodeLensProvider(this.miseService),
				),
			);
		}

		context.subscriptions.push(
			new VsCodeTaskProvider(this.miseService).tasksProvider,
		);

		context.subscriptions.push(
			new MiseFileWatcher(context, this.miseService, async (uri) => {
				logger.info(`Mise configuration file changed: ${uri}`);
				await vscode.commands.executeCommand(MISE_RELOAD);
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_LIST_ALL_TOOLS, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "TOOLS");
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_SHOW_SETTINGS, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "SETTINGS");
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_SHOW_TRACKED_CONFIG, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "TRACKED_CONFIGS");
			}),
		);

		const allTomlFilesSelector = { scheme: "file", language: "toml" };

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new MiseCompletionProvider(this.miseService),
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
					showToolVersionInline(event.document, this.miseService);
				}
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && editor.document.languageId === "toml") {
					showToolVersionInline(editor.document, this.miseService);
				}
			}),
		);

		if (vscode.window.activeTextEditor?.document.languageId === "toml") {
			void showToolVersionInline(
				vscode.window.activeTextEditor?.document,
				this.miseService,
			);
		}

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new TeraCompletionProvider(this.miseService),
				...["{", "%", "|", "."],
			),
		);
		context.subscriptions.push(
			createHoverProvider(allTomlFilesSelector, this.miseService),
		);

		await vscode.commands.executeCommand(MISE_RELOAD);

		this.statusBarItem.tooltip = new MarkdownString(
			`Mise - click to open menu\n\nVersion: ${await this.miseService.getVersion()}\n\nBinPath: ${this.miseService.getMiseBinaryPath()}`,
		);

		setTimeout(async () => {
			void this.miseService.checkNewMiseVersion();
		}, 1000);
	}

	setErrorState(errorMsg: string) {
		this.statusBarItem.text = "$(error) Mise";
		this.statusBarItem.color = new vscode.ThemeColor("errorForeground");
		this.statusBarItem.tooltip = errorMsg;
	}
}

const miseExtension = new MiseExtension();

export async function activate(context: vscode.ExtensionContext) {
	try {
		await miseExtension.activate(context);
	} catch (error) {
		logger.error("Error while activating Mise extension", error);
		miseExtension.setErrorState((error as Error).message);
		throw error;
	}
}
