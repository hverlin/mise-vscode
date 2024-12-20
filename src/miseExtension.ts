import { createCache } from "async-cache-dedupe";
import vscode, { MarkdownString } from "vscode";
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

export class MiseExtension {
	private miseService: MiseService = new MiseService();
	private statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	private miseFileWatcher: MiseFileWatcher | undefined;

	async activate(context: vscode.ExtensionContext) {
		context.subscriptions.push(this.statusBarItem);
		this.statusBarItem.show();
		this.updateStatusBar({ state: "loading" });

		await this.resetState();

		if (
			isMiseExtensionEnabled() &&
			shouldAutomaticallyTrustMiseConfigFiles() &&
			vscode.workspace.isTrusted
		) {
			await this.miseService.miseTrust();
		}

		this.miseFileWatcher = new MiseFileWatcher(
			context,
			this.miseService,
			async (uri) => {
				logger.info(`Mise configuration file changed: ${uri}`);
				await vscode.commands.executeCommand(MISE_RELOAD);
			},
		);
		this.miseFileWatcher.initialize();

		context.subscriptions.push(createMenu(this.miseService));
		this.statusBarItem.command = MISE_OPEN_MENU;

		const tasksProvider = new MiseTasksProvider(this.miseService);
		const toolsProvider = new MiseToolsProvider(this.miseService);
		const envsProvider = new MiseEnvsProvider(this.miseService);

		registerTasksCommands(context, tasksProvider);
		registerToolsCommands(context, this.miseService);
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
			try {
				logger.info("Reloading Mise configuration");
				this.updateStatusBar({ state: "loading" });

				await this.resetState();

				if (!isMiseExtensionEnabled()) {
					this.updateStatusBar({ state: "disabled" });
					return;
				}

				this.miseFileWatcher?.initialize();

				if (
					shouldAutomaticallyTrustMiseConfigFiles() &&
					vscode.workspace.isTrusted
				) {
					await this.miseService.miseTrust();
				}

				tasksProvider.refresh();
				toolsProvider.refresh();
				envsProvider.refresh();

				this.checkForMissingMiseTools();

				updateEnv(context, this.miseService).catch((error) => {
					logger.warn(
						`Unable to set environment variables from mise: ${error}`,
					);
				});

				if (
					shouldConfigureExtensionsAutomatically() &&
					isMiseExtensionEnabled()
				) {
					await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SKD_PATHS);
				}

				this.updateStatusBar({ state: "ready" });
			} catch (error) {
				this.updateStatusBar({
					state: "error",
					errorMsg: (error as Error).message,
				});
			}

			await this.updateStatusBarTooltip();
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
			const fileTaskRelativePattern = new vscode.RelativePattern(
				rootFolder,
				`{${allowedFileTaskDirs.map((dir) => `${dir}/**/*`)}}`,
			);
			context.subscriptions.push(
				vscode.languages.registerCodeLensProvider(
					[{ pattern: fileTaskRelativePattern }, { language: "shellscript" }],
					new MiseFileTaskCodeLensProvider(this.miseService),
				),
			);
		}

		context.subscriptions.push(
			new VsCodeTaskProvider(this.miseService).tasksProvider,
		);

		context.subscriptions.push(this.miseFileWatcher);

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
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.languageId === "toml") {
					vscode.commands.executeCommand(MISE_RELOAD);
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

		setTimeout(async () => {
			void this.miseService.checkNewMiseVersion();
		}, 1000);
	}

	private async resetState() {
		await Promise.all([
			vscode.commands.executeCommand(
				"setContext",
				"mise.tasksProviderError",
				false,
			),
			vscode.commands.executeCommand(
				"setContext",
				"mise.toolsProviderError",
				false,
			),
			vscode.commands.executeCommand(
				"setContext",
				"mise.envProviderError",
				false,
			),
			this.miseService.invalidateCache(),
			this.miseService.initializeMisePath(),
		]);
	}

	private updateStatusBar({
		state,
		errorMsg,
	}: {
		state?: "loading" | "error" | "ready" | "disabled";
		errorMsg?: string;
	}) {
		if (state === "error") {
			this.setErrorState(errorMsg ?? "");
			return;
		}

		const icon = state === "loading" ? "$(sync~spin)" : "$(terminal)";

		this.statusBarItem.text = `${icon} Mise`;
		if (state === "disabled") {
			this.statusBarItem.text += " (disabled)";
			return;
		}

		const miseEnv = getMiseEnv();
		if (miseEnv) {
			this.statusBarItem.text += ` (${miseEnv})`;
		}
	}

	private async updateStatusBarTooltip() {
		const version = await this.miseService.getVersion().catch(() => "unknown");
		this.statusBarItem.tooltip = new MarkdownString(
			`Mise - click to open menu\n\nVersion: ${version}\n\nBinPath: ${this.miseService.getMiseBinaryPath()}`,
		);
	}

	setErrorState(errorMsg: string) {
		this.statusBarItem.text = "$(error) Mise";
		this.statusBarItem.color = new vscode.ThemeColor("errorForeground");
		this.statusBarItem.tooltip = errorMsg;
	}

	private checkForMissingMiseTools() {
		this.miseService.getCurrentTools().then(async (tools) => {
			const missingTools = tools.filter((tool) => !tool.installed);
			if (missingTools.length > 0) {
				const selection = await vscode.window.showWarningMessage(
					`Mise: Missing tools: ${missingTools
						.map(
							(tool) => tool.name + (tool.version ? ` (${tool.version})` : ""),
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
}
