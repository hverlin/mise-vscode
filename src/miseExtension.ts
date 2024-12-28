import { createCache } from "async-cache-dedupe";
import vscode, { MarkdownString } from "vscode";
import { version } from "../package.json";
import {
	MISE_CONFIGURE_ALL_SKD_PATHS,
	MISE_EDIT_SETTING,
	MISE_FMT,
	MISE_INSTALL_ALL,
	MISE_LIST_ALL_TOOLS,
	MISE_OPEN_EXTENSION_SETTINGS,
	MISE_OPEN_FILE,
	MISE_OPEN_LOGS,
	MISE_OPEN_MENU,
	MISE_RELOAD,
	MISE_SELECT_WORKSPACE_FOLDER,
	MISE_SHOW_SETTINGS,
	MISE_SHOW_TRACKED_CONFIG,
} from "./commands";
import {
	CONFIGURATION_FLAGS,
	getCurrentWorkspaceFolder,
	getMiseEnv,
	isMiseExtensionEnabled,
	shouldAutomaticallyTrustMiseConfigFiles,
	shouldConfigureExtensionsAutomatically,
} from "./configuration";
import { createMenu } from "./extensionMenu";
import { MiseFileWatcher } from "./miseFileWatcher";
import { MiseService } from "./miseService";
import { ToolCompletionProvider } from "./providers/ToolCompletionProvider";
import { WorkspaceDecorationProvider } from "./providers/WorkspaceDecorationProvider";
import {
	MiseEnvsProvider,
	registerEnvsCommands,
	updateEnv,
} from "./providers/envProvider";
import { addToolInfoToEditor } from "./providers/inlineToolDecorator";
import { MiseCompletionProvider } from "./providers/miseCompletionProvider";
import { MiseFileTaskCodeLensProvider } from "./providers/miseFileTaskCodeLensProvider";
import {
	TeraCompletionProvider,
	createHoverProvider,
} from "./providers/miseTeraCompletionProvider";
import { MiseTomlCodeLensProvider } from "./providers/miseTomlCodeLensProvider";
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
import { displayPathRelativeTo } from "./utils/fileUtils";
import { logger } from "./utils/logger";
import { allowedFileTaskDirs } from "./utils/miseUtilts";
import WebViewPanel from "./webviewPanel";

export class MiseExtension {
	private miseService!: MiseService;
	private context!: vscode.ExtensionContext;
	private statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		0,
	);
	private miseFileWatcher: MiseFileWatcher | undefined;

	async activate(context: vscode.ExtensionContext) {
		this.context = context;
		this.miseService = new MiseService(context);
		context.subscriptions.push(this.statusBarItem);
		this.statusBarItem.show();
		this.updateStatusBar({ state: "loading" });

		const workspaceDecorationProvider = new WorkspaceDecorationProvider(
			context,
		);
		context.subscriptions.push(
			vscode.window.registerFileDecorationProvider(workspaceDecorationProvider),
		);

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
				workspaceDecorationProvider.refresh();

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
				MISE_SELECT_WORKSPACE_FOLDER,
				async (selectedPath: vscode.Uri) => {
					if (selectedPath) {
						const selectedFolder = vscode.workspace.workspaceFolders?.find(
							(folder) => folder.uri.fsPath === selectedPath.fsPath,
						);

						if (selectedFolder) {
							context.workspaceState.update(
								"selectedWorkspaceFolder",
								selectedFolder.name,
							);
							vscode.commands.executeCommand(MISE_RELOAD);
						}
						return;
					}

					const selectedFolderName = getCurrentWorkspaceFolder(context)?.name;
					const selectedFolder = await vscode.window.showWorkspaceFolderPick({
						placeHolder: [
							"Select a workspace folder to use with Mise",
							selectedFolderName ? `Current: ${selectedFolderName}` : "",
						]
							.filter(Boolean)
							.join(" "),
					});
					if (selectedFolder) {
						context.workspaceState.update(
							"selectedWorkspaceFolder",
							selectedFolder.name,
						);
						vscode.commands.executeCommand(MISE_RELOAD);
					}
				},
			),
		);

		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders?.length) {
				context.workspaceState.update("selectedWorkspaceFolder", undefined);
				vscode.commands.executeCommand(MISE_RELOAD);
				return;
			}

			const selectedWorkspaceFolderName = context.workspaceState.get(
				"selectedWorkspaceFolder",
			);

			const selectedFolder = vscode.workspace.workspaceFolders?.find(
				(folder) => folder.name === selectedWorkspaceFolderName,
			);

			if (!selectedWorkspaceFolderName || !selectedFolder) {
				const firstFolder = workspaceFolders[0];
				if (!selectedFolder && firstFolder) {
					context.workspaceState.update(
						"selectedWorkspaceFolder",
						firstFolder.name,
					);
				}
			}

			vscode.commands.executeCommand(MISE_RELOAD);
		});

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

		const rootFolders = vscode.workspace.workspaceFolders;
		if (rootFolders) {
			for (const rootFolder of rootFolders) {
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
					addToolInfoToEditor(event.document, this.miseService, context);
				}
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && editor.document.languageId === "toml") {
					addToolInfoToEditor(editor.document, this.miseService, context);
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => {
				const editor = vscode.window.activeTextEditor;
				if (editor && editor.document.languageId === "toml") {
					addToolInfoToEditor(editor.document, this.miseService, context);
				}
			}),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document.languageId === "toml") {
					vscode.commands.executeCommand(MISE_RELOAD);
				}
			}),
		);

		if (vscode.window.activeTextEditor?.document.languageId === "toml") {
			void addToolInfoToEditor(
				vscode.window.activeTextEditor?.document,
				this.miseService,
				context,
			);
		}

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new ToolCompletionProvider(this.miseService),
				...['"', "'", "="],
			),
		);

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

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_FMT, () => {
				this.miseService.miseFmt();
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_EDIT_SETTING,
				async (settingName: string) => {
					const [schema, allSettings] = await Promise.all([
						this.miseService.getSettingsSchema(),
						this.miseService.getSettings(),
					]);
					let setting = settingName;
					if (!setting) {
						const selectedSetting = await vscode.window.showQuickPick(
							schema.map((s) => ({
								label: s.key,
								description: [
									s.type ? `${s.type}` : "",
									s.deprecated ? "Deprecated" : "",
								]
									.filter(Boolean)
									.join(" | "),
								detail: s.description,
							})),
							{ placeHolder: "Select a setting" },
						);
						if (!selectedSetting) {
							return;
						}
						setting = selectedSetting.label;
					}

					const settingSchema = schema.find((s) => s.key === setting);
					if (!settingSchema) {
						logger.warn(`Setting ${setting} not found in schema`);
						return;
					}

					const currentValue = allSettings[setting]?.value;

					const value =
						settingSchema.type === "boolean"
							? await vscode.window.showQuickPick(["true", "false"], {
									placeHolder: `Select new value for ${setting}. Current value: ${currentValue}`,
								})
							: settingSchema.enum?.length
								? await vscode.window.showQuickPick(settingSchema.enum, {
										placeHolder: `Select new value for ${setting}. Current value: ${currentValue}`,
									})
								: settingSchema.type === "array"
									? await vscode.window.showInputBox({
											prompt: `Enter new value for ${setting} (comma separated). Current value: ${currentValue}`,
											value:
												typeof currentValue === "string"
													? JSON.parse(currentValue)?.join(",")
													: "",
										})
									: await vscode.window.showInputBox({
											prompt: `Enter new value for ${setting}`,
											value:
												settingSchema.type === "string"
													? (currentValue?.toString() ?? "")
													: JSON.stringify(currentValue),
										});

					if (value === undefined) {
						return;
					}

					const file =
						await this.miseService.getMiseTomlConfigFilePathsEvenIfMissing();
					const selectedFilePath = await vscode.window.showQuickPick(file, {
						placeHolder: "Select a configuration file",
					});

					if (!selectedFilePath) {
						return;
					}

					await this.miseService.editSetting(setting, {
						filePath: selectedFilePath,
						value,
					});
				},
			),
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

		if ((vscode.workspace.workspaceFolders?.length || 0) > 1) {
			const selectedFolder = getCurrentWorkspaceFolder(this.context);
			if (selectedFolder) {
				this.statusBarItem.text += ` [${selectedFolder?.name ?? "?"}]`;
			}
		}
	}

	private async updateStatusBarTooltip() {
		const miseVersion = await this.miseService
			.getVersion()
			.catch(() => "unknown");
		this.statusBarItem.tooltip = new MarkdownString("", true);
		this.statusBarItem.tooltip.isTrusted = true;

		const selectedFolderName = getCurrentWorkspaceFolder(this.context)?.name;

		const infoList = [
			`Mise VSCode ${version} - [Command Menu](command:${MISE_OPEN_MENU})`,
			(vscode.workspace.workspaceFolders?.length || 0) > 1
				? `[Select Workspace Folder](command:${MISE_SELECT_WORKSPACE_FOLDER}) [${selectedFolderName}]`
				: "",
			`[$(tools) Mise Tools](command:${MISE_LIST_ALL_TOOLS})`,
			`[$(gear) Mise Settings](command:${MISE_SHOW_SETTINGS})`,
			`[$(list-unordered) Tracked Configurations](command:${MISE_SHOW_TRACKED_CONFIG})`,
			`[BinPath: ${displayPathRelativeTo(this.miseService.getMiseBinaryPath() || "Not set", "")}](command:${MISE_OPEN_EXTENSION_SETTINGS})`,
			`Mise Version: ${miseVersion}`,
		].filter(Boolean);

		this.statusBarItem.tooltip.appendMarkdown(infoList.join("\n\n"));
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
