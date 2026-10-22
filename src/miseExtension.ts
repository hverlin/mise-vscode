import { createHash } from "node:crypto";
import path from "node:path";
import { createCache } from "async-cache-dedupe";
import vscode, { MarkdownString } from "vscode";
import { version } from "../package.json";
import {
	MISE_CONFIGURE_ALL_SDK_PATHS,
	MISE_DISMISS_MISSING_TOOLS_WARNING,
	MISE_DOCTOR,
	MISE_EDIT_SETTING,
	MISE_ENABLE_AUTO_CONFIGURATION,
	MISE_FMT,
	MISE_LIST_ALL_TOOLS,
	MISE_MISSING_TOOLS_MENU,
	MISE_OPEN_EXTENSION_SETTINGS,
	MISE_OPEN_FILE,
	MISE_OPEN_LOGS,
	MISE_OPEN_MENU,
	MISE_RELOAD,
	MISE_RELOAD_FROM_USER,
	MISE_REVIEW_UNTRUSTED_CONFIG,
	MISE_REVIEW_WORKSPACE_BINARY,
	MISE_REVOKE_WORKSPACE_BINARIES,
	MISE_RUN_PROJECT_CHECKS,
	MISE_SELECT_WORKSPACE_FOLDER,
	MISE_SHOW_BOOTSTRAP,
	MISE_SHOW_PROJECTS,
	MISE_SHOW_SETTINGS,
	MISE_SHOW_TRACKED_CONFIG,
	MISE_TOGGLE_TRUST_OWN_EDITS,
	MISE_VISUALIZE_TASKS_DEPS,
} from "./commands";
import {
	areSnippetsEnabled,
	CONFIGURATION_FLAGS,
	clearCurrentWorkspaceFolder,
	enableAutoConfiguration,
	getConfiguredBinPath,
	getCurrentWorkspaceFolder,
	getMiseEnv,
	isBinPathSetByWorkspace,
	isMiseExtensionEnabled,
	isTaskSymbolProviderEnabled,
	setCurrentWorkspaceFolder,
	shouldAutomaticallyTrustMiseConfigFiles,
	shouldConfigureExtensionsAutomatically,
	shouldShowNotificationIfMissingTools,
	shouldTrustOwnEditsInParanoidMode,
	shouldUseSymLinks,
} from "./configuration";
import { DaemonsService } from "./daemonsService";
import { createMenu, createMissingToolsMenu } from "./extensionMenu";
import { MiseFileWatcher } from "./miseFileWatcher";
import { MiseService } from "./miseService";
import {
	MiseBootstrapProvider,
	registerBootstrapCommands,
} from "./providers/bootstrapProvider";
import {
	ConfigKeyDiagnostics,
	ConfigKeyQuickFixProvider,
} from "./providers/configKeyDiagnostics";
import { ConfigRootsCompletionProvider } from "./providers/configRootsCompletionProvider";
import { DaemonCodeLensProvider } from "./providers/daemonCodeLensProvider";
import {
	DaemonNameCompletionProvider,
	DaemonNameDefinitionProvider,
	DaemonNameHoverProvider,
} from "./providers/daemonNameProviders";
import {
	DAEMONS_VIEW_ID,
	MiseDaemonsProvider,
	pollDaemons,
	registerDaemonsCommands,
} from "./providers/daemonsProvider";
import { DaemonsSession } from "./providers/daemonsSession";
import { DaemonsStatus } from "./providers/daemonsStatus";
import {
	MiseEnvsProvider,
	registerEnvsCommands,
	updateEnv,
} from "./providers/envProvider";
import { addToolInfoToEditor } from "./providers/inlineToolDecorator";
import { MiseTextDocumentContentProvider } from "./providers/MiseTextDocumentContentProvider";
import { MiseTomlTaskSymbolProvider } from "./providers/MiseTomlTaskSymbolProvider";
import { registerMcpServers } from "./providers/mcpServers";
import { MiseCompletionProvider } from "./providers/miseCompletionProvider";
import { MiseFileTaskCodeLensProvider } from "./providers/miseFileTaskCodeLensProvider";
import { MiseSnippetProvider } from "./providers/miseSnippetProvider";
import {
	createTeraHoverProvider,
	TeraCompletionProvider,
} from "./providers/miseTeraCompletionProvider";
import { MiseTomlCodeLensProvider } from "./providers/miseTomlCodeLensProvider";
import {
	UsageCompletionProvider,
	UsageHoverProvider,
	usageTriggerCharacters,
} from "./providers/miseUsageCompletionProvider";
import { runProjectChecks } from "./providers/projectChecks";
import { TaskDefinitionProvider } from "./providers/TaskDefinitionProvider";
import { TaskHoverProvider } from "./providers/TaskHoverProvider";
import { TaskReferenceProvider } from "./providers/TaskReferenceProvider";
import { TaskTemplateCompletionProvider } from "./providers/TaskTemplateCompletionProvider";
import { ToolCompletionProvider } from "./providers/ToolCompletionProvider";
import { registerTomlFileLinks } from "./providers/taskIncludesNavigation";
import {
	MiseTasksProvider,
	registerTasksCommands,
} from "./providers/tasksProvider";
import { TaskValidationDiagnostics } from "./providers/taskValidationDiagnostics";
import { createToolHoverProvider } from "./providers/toolHoverProvider";
import { createToolLinkProvider } from "./providers/toolLinkProvider";
import {
	type ConfigureAllSdkPathsOptions,
	MiseToolsProvider,
	registerToolsCommands,
} from "./providers/toolsProvider";
import { VsCodeTaskProvider } from "./providers/vsCodeTaskProvider";
import { WorkspaceDecorationProvider } from "./providers/WorkspaceDecorationProvider";
import { pitchforkUserConfig } from "./utils/daemons";
import { displayPathRelativeTo, expandPath } from "./utils/fileUtils";
import { debounce, truncateStr } from "./utils/fn";
import { getMissingTools } from "./utils/lazyTools";
import { logger } from "./utils/logger";
import { escapeMarkdown, markdownCodeSpan } from "./utils/markdown";
import {
	allowedFileTaskDirs,
	isToolVersionsFile,
	parseMiseError,
} from "./utils/miseUtilts";
import { recommendTombiStringTokensOff } from "./utils/tombiStringTokens";
import WebViewPanel from "./webviewPanel";

const MANAGE_WORKSPACE_TRUST = "workbench.trust.manage";

export class MiseExtension {
	private miseService!: MiseService;
	private context!: vscode.ExtensionContext;
	private statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		0,
	);
	private missingToolBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		0,
	);
	private invalidMiseConfigStatusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		0,
	);

	private miseFileWatcher: MiseFileWatcher | undefined;

	/** The config files are trusted along with the workspace, see setUntrustedConfigState */
	private configsWaitForWorkspaceTrust = false;

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
		this.configsWaitForWorkspaceTrust =
			await this.miseService.waitsForWorkspaceTrust();

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
				// before the reload, which reads the file with mise
				await this.miseService.trustOwnEdit(uri.fsPath);
				await vscode.commands.executeCommand(MISE_RELOAD);
			},
		);
		this.miseFileWatcher.initialize();

		context.subscriptions.push(
			createMenu(this.miseService),
			createMissingToolsMenu(),
		);
		this.statusBarItem.command = MISE_OPEN_MENU;

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_DISMISS_MISSING_TOOLS_WARNING,
				async () => {
					const tools = await this.miseService.getCurrentTools();
					const missingTools = getMissingTools(tools);
					const hash = this.generateMissingToolsHash(missingTools);

					const dismissedHashes = this.context.workspaceState.get<string[]>(
						"dismissedMissingToolsHashes",
						[],
					);

					if (!dismissedHashes.includes(hash)) {
						dismissedHashes.push(hash);
						await context.workspaceState.update(
							"dismissedMissingToolsHashes",
							dismissedHashes,
						);
					}

					this.missingToolBarItem.hide();
					logger.info("Dismissed missing tools warning");
				},
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_REVIEW_WORKSPACE_BINARY,
				async () => {
					const binPath = this.miseService.pendingBinaryApproval;
					if (!binPath) {
						vscode.window.showInformationMessage(
							"No mise binary is waiting for approval in this workspace.",
						);
						return;
					}

					await this.miseService.reviewWorkspaceBinary();
					await vscode.commands.executeCommand(MISE_RELOAD);
				},
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_REVIEW_UNTRUSTED_CONFIG,
				// with a file: one the user told mise to ignore, see the code lens
				(filePath?: string) =>
					typeof filePath === "string"
						? this.miseService.reviewIgnoredConfig(filePath)
						: this.miseService.reviewUntrustedConfig(),
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_TOGGLE_TRUST_OWN_EDITS, () =>
				vscode.workspace.getConfiguration("mise").update(
					CONFIGURATION_FLAGS.trustOwnEditsInParanoidMode,
					!shouldTrustOwnEditsInParanoidMode(),
					// a project cannot turn it on, see the scope of the setting
					vscode.ConfigurationTarget.Global,
				),
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_REVOKE_WORKSPACE_BINARIES,
				async () => {
					const approved = this.miseService.listApprovedWorkspaceBinaries();
					if (!approved.length) {
						vscode.window.showInformationMessage(
							"No workspace mise binary has been approved.",
						);
						return;
					}

					const selected = await vscode.window.showQuickPick(approved, {
						canPickMany: true,
						title: "Revoke approved workspace mise binaries",
						placeHolder: "Mise will ask again before running the ones you pick",
					});
					if (!selected?.length) {
						return;
					}

					await this.miseService.revokeWorkspaceBinaryApprovals(selected);
					await vscode.commands.executeCommand(MISE_RELOAD);
				},
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_ENABLE_AUTO_CONFIGURATION,
				async () => {
					await enableAutoConfiguration();
					logger.info("Auto-configuration enabled");
					await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
					vscode.window.showInformationMessage(
						"Mise auto-configuration has been enabled and extensions have been configured.",
					);
				},
			),
		);
		const tasksProvider = new MiseTasksProvider(this.miseService);
		const toolsProvider = new MiseToolsProvider(this.miseService);
		const envsProvider = new MiseEnvsProvider(this.miseService);
		const bootstrapProvider = new MiseBootstrapProvider(this.miseService);

		const tasksTreeView = vscode.window.createTreeView("miseTasksView", {
			treeDataProvider: tasksProvider,
			showCollapseAll: true,
		});
		context.subscriptions.push(
			tasksTreeView,
			vscode.window.createTreeView("miseToolsView", {
				treeDataProvider: toolsProvider,
				showCollapseAll: true,
			}),
			vscode.window.createTreeView("miseEnvsView", {
				treeDataProvider: envsProvider,
				showCollapseAll: true,
			}),
		);

		registerTasksCommands(context, tasksProvider, tasksTreeView);
		registerToolsCommands(context, this.miseService);
		registerEnvsCommands(context, envsProvider, this.miseService);
		registerBootstrapCommands(context, this.miseService);

		const daemonsService = new DaemonsService(this.miseService);
		const daemonsProvider = new MiseDaemonsProvider(daemonsService);
		const daemonsTreeView = vscode.window.createTreeView(DAEMONS_VIEW_ID, {
			treeDataProvider: daemonsProvider,
		});
		const daemonsSession = new DaemonsSession(daemonsService);
		const updateMcpServers = registerMcpServers(
			context,
			this.miseService,
			daemonsService,
		);
		registerDaemonsCommands(context, daemonsProvider, daemonsService, () =>
			this.miseService.getCurrentWorkspaceFolderPath(),
		);
		// the mise configs reload everything, see MiseFileWatcher
		const pitchforkConfigWatchers = [
			vscode.workspace.createFileSystemWatcher(
				"**/{pitchfork,pitchfork.local}.toml",
			),
			vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(
					vscode.Uri.file(path.dirname(pitchforkUserConfig())),
					"config.toml",
				),
			),
		];
		const onPitchforkConfigChange = () => {
			void daemonsProvider.refresh();
			void daemonsSession.sync();
		};
		for (const watcher of pitchforkConfigWatchers) {
			watcher.onDidChange(onPitchforkConfigChange);
			watcher.onDidCreate(onPitchforkConfigChange);
			watcher.onDidDelete(onPitchforkConfigChange);
		}
		context.subscriptions.push(
			daemonsTreeView,
			pollDaemons(daemonsTreeView, daemonsProvider),
			new DaemonsStatus(daemonsProvider),
			daemonsSession,
			...pitchforkConfigWatchers,
			vscode.languages.registerCodeLensProvider(
				{ language: "toml" },
				new DaemonCodeLensProvider(daemonsProvider, () =>
					this.miseService.getCurrentWorkspaceFolderPath(),
				),
			),
		);

		const taskValidationDiagnostics = new TaskValidationDiagnostics(
			this.miseService,
		);
		context.subscriptions.push(taskValidationDiagnostics);
		const configKeyDiagnostics = new ConfigKeyDiagnostics(this.miseService);
		context.subscriptions.push(
			configKeyDiagnostics,
			vscode.languages.registerCodeActionsProvider(
				{ language: "toml" },
				new ConfigKeyQuickFixProvider(configKeyDiagnostics),
				{
					providedCodeActionKinds:
						ConfigKeyQuickFixProvider.providedCodeActionKinds,
				},
			),
		);

		vscode.window.registerTreeDataProvider(
			"miseBootstrapView",
			bootstrapProvider,
		);

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

		const reloadConfiguration = async () => {
			try {
				logger.info("Reloading Mise configuration");
				this.updateStatusBar({ state: "loading" });
				workspaceDecorationProvider.refresh();

				await this.resetState();

				if (!isMiseExtensionEnabled()) {
					this.updateStatusBar({ state: "disabled" });
					return;
				}

				// nothing may run against a binary the user has not approved
				if (this.miseService.pendingBinaryApproval) {
					this.updateStatusBar({ state: "unapproved" });
					return;
				}

				this.miseFileWatcher?.initialize();

				this.configsWaitForWorkspaceTrust =
					await this.miseService.waitsForWorkspaceTrust();
				if (
					shouldAutomaticallyTrustMiseConfigFiles() &&
					vscode.workspace.isTrusted
				) {
					await this.miseService.miseTrust();
				}

				tasksProvider.refresh();
				toolsProvider.refresh();
				envsProvider.refresh();
				bootstrapProvider.refresh();

				this.checkForMissingMiseTools();

				const envUpdate = updateEnv(context, this.miseService).catch(
					(error) => {
						logger.warn(
							`Unable to set environment variables from mise: ${error}`,
						);
					},
				);

				if (isMiseExtensionEnabled()) {
					if (shouldConfigureExtensionsAutomatically()) {
						await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
					} else if (shouldUseSymLinks()) {
						// the settings are written by hand: only keep the links they
						// point at up to date
						await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS, {
							writeSettings: false,
						} satisfies ConfigureAllSdkPathsOptions);
					}
				}

				// activation awaits this reload: extensions activated after this one
				// (onStartupFinished) spawn their processes with the env it applied
				await envUpdate;

				this.updateStatusBar({ state: "ready" });
			} catch (error) {
				// an untrusted config has a state of its own, see untrustedConfigFile
				this.updateStatusBar(
					parseMiseError(error).kind === "untrusted"
						? { state: "ready" }
						: { state: "error", errorMsg: (error as Error).message },
				);
			} finally {
				// once the configs are trusted, and also when the reload stopped early
				// (extension disabled, binary not approved) to clear them
				taskValidationDiagnostics.scheduleRefresh();
				configKeyDiagnostics.scheduleRefresh();
				daemonsService.forgetPitchfork();
				void daemonsProvider.refresh();
				void daemonsSession.sync();
				updateMcpServers();
			}

			void this.checkForInvalidMiseConfigFiles();
			await this.updateStatusBarTooltip();
		};

		// internal triggers (file watcher, task end, config change) come in
		// storms: close reloads are coalesced into one
		const globalCmdCache = createCache({
			ttl: 1,
		}).define("reload", reloadConfiguration);

		context.subscriptions.push(
			vscode.commands.registerCommand(
				MISE_RELOAD,
				async (options?: { force?: boolean }) => {
					if (options?.force) {
						// a deliberate state change (folder switch, reload asked by
						// the user) must not be coalesced into an already running
						// reload, which read the state from before the change
						await globalCmdCache.clear();
						await reloadConfiguration();
						return;
					}
					await globalCmdCache.reload();
				},
			),
			// only the reload the user asked for drops what was kept from before a
			// config file broke: the internal reloads above must not empty the
			// views while the file is still being typed
			vscode.commands.registerCommand(MISE_RELOAD_FROM_USER, async () => {
				this.miseService.forgetRetainedState();
				await vscode.commands.executeCommand(MISE_RELOAD, { force: true });
			}),
		);

		// Auto save writes a config file in the middle of typing, and the views
		// keep their previous state rather than emptying until it parses again.
		// A save the user asked for is different: it is deliberate, so nothing is
		// carried over and a broken config shows as broken.
		// the indicator has to appear the moment a read falls back, and clear as
		// soon as the file parses again, without waiting for a reload
		context.subscriptions.push(
			this.miseService.subscribeToRetainedStateChange(() => {
				this.updateStatusBar({});
			}),
		);

		context.subscriptions.push(
			this.miseService.subscribeToUntrustedConfigChange(() => {
				this.updateStatusBar({});
			}),
			// the reload trusts the config files, now that the workspace is
			vscode.workspace.onDidGrantWorkspaceTrust(() => {
				vscode.commands.executeCommand(MISE_RELOAD, { force: true });
			}),
		);

		context.subscriptions.push(
			vscode.workspace.onWillSaveTextDocument((e) => {
				if (e.reason !== vscode.TextDocumentSaveReason.Manual) {
					return;
				}
				if (
					e.document.fileName.endsWith(".toml") ||
					isToolVersionsFile(e.document.fileName)
				) {
					this.miseService.notifyManualSave(e.document.uri);
				}
				// a `.env` loaded with `env._.file` has trust of its own in paranoid
				// mode. Whether the file is trusted is read before it is written
				if (
					e.document.fileName.endsWith(".toml") ||
					isToolVersionsFile(e.document.fileName) ||
					this.miseService.isEnvFile(e.document.uri.fsPath)
				) {
					e.waitUntil(this.miseService.expectOwnEdit(e.document.uri.fsPath));
				}
			}),
			// whether mise trusts an env file is checked when its edit starts:
			// asking mise when it is saved can take longer than VS Code waits
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (!this.miseService.isEnvFile(e.document.uri.fsPath)) {
					return;
				}
				if (e.document.isDirty) {
					this.miseService.checkEnvFileTrust(e.document.uri.fsPath);
				} else {
					// saved, or reverted
					this.miseService.endEnvFileEdit(e.document.uri.fsPath);
				}
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				this.miseService.endEnvFileEdit(document.uri.fsPath);
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
							await setCurrentWorkspaceFolder(context, selectedFolder);
							vscode.commands.executeCommand(MISE_RELOAD, { force: true });
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
						await setCurrentWorkspaceFolder(context, selectedFolder);
						vscode.commands.executeCommand(MISE_RELOAD, { force: true });
					}
				},
			),
		);

		vscode.workspace.onDidChangeWorkspaceFolders(async () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders?.length) {
				await clearCurrentWorkspaceFolder(context);
				vscode.commands.executeCommand(MISE_RELOAD, { force: true });
				return;
			}

			// the folder that was selected may be gone: store whichever one is
			// current now, which is the first folder when the selection is stale
			const currentFolder = getCurrentWorkspaceFolder(context);
			if (currentFolder) {
				await setCurrentWorkspaceFolder(context, currentFolder);
			}

			vscode.commands.executeCommand(MISE_RELOAD, { force: true });
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
					vscode.window.showTextDocument(
						vscode.Uri.file(selectedUri as string),
					);
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
			vscode.commands.registerCommand(MISE_SHOW_PROJECTS, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "PROJECTS");
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_SHOW_TRACKED_CONFIG, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "PROJECTS", {
					flatFileView: true,
				});
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_VISUALIZE_TASKS_DEPS, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "TASKS_DEPS");
			}),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_SHOW_BOOTSTRAP, async () => {
				WebViewPanel.createOrShow(context, this.miseService, "BOOTSTRAP");
			}),
		);

		const allTomlFilesSelector = { scheme: "file", language: "toml" };
		// `.tool-versions` files have no language contribution (plaintext),
		// so tool features match them by file name pattern instead
		const toolVersionsSelector = {
			scheme: "file",
			pattern: "**/.tool-versions",
		};
		const toolFilesSelector = [allTomlFilesSelector, toolVersionsSelector];

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new MiseCompletionProvider(this.miseService),
				...['"', "'", "[", ","],
			),
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new ConfigRootsCompletionProvider(),
				...['"', "'", "[", ",", "/"],
			),
			vscode.languages.registerCompletionItemProvider(
				// file tasks extend templates from their `#MISE extends=` header
				[allTomlFilesSelector, { scheme: "file", language: "shellscript" }],
				new TaskTemplateCompletionProvider(this.miseService),
				...['"', "'", "=", ":"],
			),
			vscode.languages.registerDefinitionProvider(
				allTomlFilesSelector,
				new TaskDefinitionProvider(this.miseService),
			),
			vscode.languages.registerReferenceProvider(
				allTomlFilesSelector,
				new TaskReferenceProvider(this.miseService),
			),
			vscode.languages.registerHoverProvider(
				allTomlFilesSelector,
				new TaskHoverProvider(this.miseService),
			),
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new DaemonNameCompletionProvider(daemonsProvider),
				...['"', "'", "[", ","],
			),
			vscode.languages.registerDefinitionProvider(
				allTomlFilesSelector,
				new DaemonNameDefinitionProvider(daemonsProvider, () =>
					this.miseService.getCurrentWorkspaceFolderPath(),
				),
			),
			vscode.languages.registerHoverProvider(
				allTomlFilesSelector,
				new DaemonNameHoverProvider(daemonsProvider),
			),
		);

		registerTomlFileLinks(context);

		context.subscriptions.push(
			vscode.workspace.registerTextDocumentContentProvider(
				"mise",
				new MiseTextDocumentContentProvider(this.miseService),
			),
		);

		context.subscriptions.push(
			vscode.commands.registerCommand(MISE_DOCTOR, async () => {
				await vscode.window.showTextDocument(
					await vscode.workspace.openTextDocument(
						vscode.Uri.parse("mise:/MISE_DOCTOR"),
					),
				);
			}),
			vscode.commands.registerCommand(MISE_RUN_PROJECT_CHECKS, () =>
				runProjectChecks(this.miseService),
			),
		);

		const debouncedAddToolInfo = new Map<
			string,
			(
				document: vscode.TextDocument,
				service: MiseService,
				ctx: vscode.ExtensionContext,
			) => void
		>();

		const getDebouncedForDoc = (uri: string) => {
			if (!debouncedAddToolInfo.has(uri)) {
				debouncedAddToolInfo.set(uri, debounce(addToolInfoToEditor, 500));
			}
			return (
				debouncedAddToolInfo.get(uri) ?? debounce(addToolInfoToEditor, 500)
			);
		};

		const isToolsDocument = (document: vscode.TextDocument) =>
			document.languageId === "toml" || isToolVersionsFile(document.fileName);

		context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (
					event.document === vscode.window.activeTextEditor?.document &&
					isToolsDocument(event.document)
				) {
					getDebouncedForDoc(event.document.uri.toString())(
						event.document,
						this.miseService,
						context,
					);
				}
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && isToolsDocument(editor.document)) {
					addToolInfoToEditor(editor.document, this.miseService, context);
				}
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor) {
					void recommendTombiStringTokensOff(context, editor.document);
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => {
				const editor = vscode.window.activeTextEditor;
				if (editor && isToolsDocument(editor.document)) {
					addToolInfoToEditor(editor.document, this.miseService, context);
				}
			}),
			vscode.workspace.onDidSaveTextDocument(async (document) => {
				// the file watcher only watches the env files mise loaded last time
				if (
					isToolsDocument(document) ||
					this.miseService.isEnvFile(document.uri.fsPath)
				) {
					// before the reload, which reads the file with mise
					await this.miseService.trustOwnEdit(document.uri.fsPath);
					vscode.commands.executeCommand(MISE_RELOAD);
				}
			}),
		);

		if (
			vscode.window.activeTextEditor &&
			isToolsDocument(vscode.window.activeTextEditor.document)
		) {
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
				...['"', "'", "=", "."],
			),
			vscode.languages.registerCompletionItemProvider(
				toolVersionsSelector,
				new ToolCompletionProvider(this.miseService),
				" ",
				":",
			),
		);

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new TeraCompletionProvider(this.miseService),
				...["{", "%", "|", ".", " "],
			),
		);

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				new UsageCompletionProvider(this.miseService),
				...usageTriggerCharacters,
			),
			vscode.languages.registerCompletionItemProvider(
				{ scheme: "file", language: "shellscript" },
				new UsageCompletionProvider(this.miseService),
				...usageTriggerCharacters,
			),
			vscode.languages.registerHoverProvider(
				allTomlFilesSelector,
				new UsageHoverProvider(this.miseService),
			),
			vscode.languages.registerHoverProvider(
				{ scheme: "file", language: "shellscript" },
				new UsageHoverProvider(this.miseService),
			),
		);

		const snippetProvider = new MiseSnippetProvider({
			isEnabled: () => isMiseExtensionEnabled() && areSnippetsEnabled(),
			isTrackedByMise: async (document) =>
				(await this.miseService.getCurrentConfigFiles()).includes(
					expandPath(document.uri.fsPath),
				),
		});

		context.subscriptions.push(
			vscode.languages.registerCompletionItemProvider(
				allTomlFilesSelector,
				snippetProvider,
			),
			vscode.languages.registerCompletionItemProvider(
				{ scheme: "file", language: "shellscript" },
				snippetProvider,
			),
		);

		context.subscriptions.push(
			createTeraHoverProvider(allTomlFilesSelector, this.miseService),
		);

		context.subscriptions.push(
			createToolHoverProvider(toolFilesSelector, this.miseService),
		);

		context.subscriptions.push(
			createToolLinkProvider(toolFilesSelector, this.miseService),
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

		if (isTaskSymbolProviderEnabled()) {
			context.subscriptions.push(
				vscode.languages.registerDocumentSymbolProvider(
					allTomlFilesSelector,
					new MiseTomlTaskSymbolProvider(vscode),
				),
			);
		}

		await vscode.commands.executeCommand(MISE_RELOAD);

		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			void recommendTombiStringTokensOff(context, activeEditor.document);
		}

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
			vscode.commands.executeCommand(
				"setContext",
				"mise.bootstrapProviderError",
				false,
			),
			this.miseService.invalidateCache(),
			this.miseService.initializeMisePath(),
		]);
		// what mise refuses is learned again by the reload
		this.miseService.resetUntrustedConfigFiles();
	}

	private updateStatusBar({
		state,
		errorMsg,
	}: {
		state?: "loading" | "error" | "ready" | "disabled" | "unapproved";
		errorMsg?: string;
	}) {
		this.lastStatusBarState = state ?? this.lastStatusBarState;

		if (state === "error") {
			this.setErrorState(errorMsg ?? "");
			return;
		}

		if (state === "unapproved") {
			this.setUnapprovedBinaryState();
			return;
		}

		if (this.miseService.untrustedConfigFiles.length) {
			this.setUntrustedConfigState(this.miseService.untrustedConfigFiles);
			return;
		}

		if (this.miseService.isServingRetainedState) {
			this.setRetainedStateIndicator();
			return;
		}

		const icon = state === "loading" ? "$(sync~spin)" : "$(gear)";
		this.statusBarItem.color = undefined;
		this.statusBarItem.backgroundColor = undefined;
		this.statusBarItem.command = MISE_OPEN_MENU;

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

		let miseBinPath = getConfiguredBinPath() || "Not set";
		if (!this.miseService.hasValidMiseBinPath) {
			miseBinPath += " (invalid)";
		}

		// the tooltip is trusted, so it renders `command:` links: every value
		// coming from settings or from the mise binary has to be escaped
		const infoList = [
			`Mise VSCode ${version} - [Command Menu](command:${MISE_OPEN_MENU})`,
			(vscode.workspace.workspaceFolders?.length || 0) > 1
				? `[Select Workspace Folder](command:${MISE_SELECT_WORKSPACE_FOLDER}) [${escapeMarkdown(selectedFolderName ?? "")}]`
				: "",
			`[$(tools) Mise Tools](command:${MISE_LIST_ALL_TOOLS})`,
			`[$(gear) Mise Settings](command:${MISE_SHOW_SETTINGS})`,
			`[$(folder-library) Mise Projects](command:${MISE_SHOW_PROJECTS})`,
			`[BinPath: ${markdownCodeSpan(displayPathRelativeTo(miseBinPath, ""))}](command:${MISE_OPEN_EXTENSION_SETTINGS})`,
			miseVersion ? `Mise Version: ${escapeMarkdown(miseVersion)}` : "",
		].filter(Boolean);

		this.statusBarItem.tooltip.appendMarkdown(infoList.join("\n\n"));
	}

	/**
	 * Nothing runs while a workspace mise binary is unapproved, so the status
	 * bar has to say so rather than look idle: it turns into a warning that
	 * opens the decision again.
	 */
	private setUnapprovedBinaryState() {
		const binPath = this.miseService.pendingBinaryApproval ?? "";
		this.statusBarItem.text = "$(shield) Mise (not approved)";
		this.statusBarItem.color = undefined;
		this.statusBarItem.backgroundColor = new vscode.ThemeColor(
			"statusBarItem.warningBackground",
		);
		this.statusBarItem.command = MISE_REVIEW_WORKSPACE_BINARY;

		const setByWorkspace = isBinPathSetByWorkspace();

		const tooltip = new MarkdownString("", true);
		tooltip.isTrusted = true;
		tooltip.appendMarkdown(
			[
				"**Mise is not running in this workspace.**",
				`It is configured to use a mise binary shipped with the project: ${markdownCodeSpan(binPath)}`,
				setByWorkspace
					? "`mise.binPath` is set by this project's own `.vscode/settings.json`, not by your user settings. Inspect that file before approving."
					: "`mise.binPath` comes from your own settings.",
				"Nothing from mise runs until you decide about it.",
				[
					`[$(shield) Review this binary](command:${MISE_REVIEW_WORKSPACE_BINARY})`,
					setByWorkspace
						? "[$(json) Inspect settings.json](command:workbench.action.openWorkspaceSettingsFile)"
						: "",
					`[$(gear) Extension settings](command:${MISE_OPEN_EXTENSION_SETTINGS})`,
				]
					.filter(Boolean)
					.join(" · "),
			].join("\n\n"),
		);
		this.statusBarItem.tooltip = tooltip;
	}

	/** Last state asked for, so the indicator can hand it back when it clears */
	private lastStatusBarState:
		| "loading"
		| "error"
		| "ready"
		| "disabled"
		| "unapproved"
		| undefined;

	/**
	 * mise refuses to load config files that are not trusted. In an untrusted
	 * workspace, outside paranoid mode, they are trusted along with the
	 * workspace, so the status bar only says so instead of turning into a
	 * warning.
	 */
	private setUntrustedConfigState(files: readonly string[]) {
		const waitsForWorkspaceTrust = this.configsWaitForWorkspaceTrust;
		this.statusBarItem.text = "$(shield) Mise (not trusted)";
		this.statusBarItem.color = waitsForWorkspaceTrust
			? undefined
			: new vscode.ThemeColor("statusBarItem.warningForeground");
		this.statusBarItem.backgroundColor = waitsForWorkspaceTrust
			? undefined
			: new vscode.ThemeColor("statusBarItem.warningBackground");
		this.statusBarItem.command = waitsForWorkspaceTrust
			? MANAGE_WORKSPACE_TRUST
			: MISE_REVIEW_UNTRUSTED_CONFIG;

		const names = files.map((file) =>
			markdownCodeSpan(
				displayPathRelativeTo(
					file,
					this.miseService.getCurrentWorkspaceFolderPath(),
				),
			),
		);
		const tooltip = new MarkdownString("", true);
		tooltip.isTrusted = true;
		tooltip.appendMarkdown(
			[
				names.length === 1
					? `**mise does not load ${names[0]}**, which is not trusted.`
					: `**mise does not load these files**, which are not trusted:\n\n${names.map((name) => `- ${name}`).join("\n")}`,
				waitsForWorkspaceTrust
					? `The extension trusts ${names.length === 1 ? "it" : "them"} once you trust this workspace.`
					: "",
				[
					waitsForWorkspaceTrust
						? `[$(workspace-trusted) Manage Workspace Trust](command:${MANAGE_WORKSPACE_TRUST})`
						: "",
					`[$(shield) Review](command:${MISE_REVIEW_UNTRUSTED_CONFIG})`,
				]
					.filter(Boolean)
					.join(" · "),
			]
				.filter(Boolean)
				.join("\n\n"),
		);
		this.statusBarItem.tooltip = tooltip;
		this.statusBarItem.show();
	}

	private setRetainedStateIndicator() {
		this.statusBarItem.text = "$(warning) Mise";
		this.statusBarItem.color = new vscode.ThemeColor(
			"statusBarItem.warningForeground",
		);
		this.statusBarItem.backgroundColor = new vscode.ThemeColor(
			"statusBarItem.warningBackground",
		);
		this.statusBarItem.tooltip =
			"A mise config file does not parse. The panels show the last state that could be read.";
		this.statusBarItem.command = MISE_OPEN_MENU;
		this.statusBarItem.show();
	}

	setErrorState(errorMsg: string) {
		this.statusBarItem.text = "$(error) Mise";
		this.statusBarItem.color = new vscode.ThemeColor("errorForeground");
		this.statusBarItem.backgroundColor = undefined;
		this.statusBarItem.tooltip = errorMsg;
	}

	private async checkForInvalidMiseConfigFiles() {
		const resetStatusBar = () => {
			this.invalidMiseConfigStatusBarItem.hide();
			this.invalidMiseConfigStatusBarItem.command = undefined;
			this.invalidMiseConfigStatusBarItem.tooltip = undefined;
			this.invalidMiseConfigStatusBarItem.text = "";
		};

		try {
			await this.miseService.getMiseConfigFiles();
			resetStatusBar();
		} catch (error) {
			// nothing is wrong with an untrusted config: it has a state of its own
			if (
				!(error instanceof Error) ||
				parseMiseError(error).kind === "untrusted"
			) {
				resetStatusBar();
				return;
			}

			if (error.message.includes("mise ERROR error parsing config file")) {
				const filePathMatch = error.message.match(
					/error parsing config file: (.*?\.toml)/,
				);
				const invalidMiseCfgFile = filePathMatch?.[1];
				if (invalidMiseCfgFile) {
					const filePath = expandPath(invalidMiseCfgFile);
					this.invalidMiseConfigStatusBarItem.text = `Invalid Mise config: ${filePath}`;
					this.invalidMiseConfigStatusBarItem.color = new vscode.ThemeColor(
						"errorForeground",
					);
					const errorParts = error.message.split(
						"mise ERROR error parsing config file:",
						2,
					);
					const mainError = errorParts[1]
						? `Error parsing config file: ${errorParts[1]}`
						: error.message;

					const cleanedError = mainError.split(
						"mise ERROR Run with --verbose or MISE_VERBOSE=1 for more information",
					)[0];

					this.invalidMiseConfigStatusBarItem.tooltip =
						cleanedError?.replace(/mise ERROR /g, "").trim() || error.message;

					this.invalidMiseConfigStatusBarItem.command = {
						title: "Open Invalid Mise Config File",
						command: MISE_OPEN_FILE,
						arguments: [filePath],
					};
					this.invalidMiseConfigStatusBarItem.show();
					this.setErrorState(
						`Mise configuration file is invalid: ${filePath}. Please fix or remove this file.`,
					);
				}
			}
		}
	}

	private checkForMissingMiseTools() {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		if (!shouldShowNotificationIfMissingTools()) {
			return;
		}

		this.miseService.getCurrentTools().then(async (tools) => {
			const missingTools = getMissingTools(tools);

			if (!missingTools.length) {
				if (this.missingToolBarItem) {
					this.missingToolBarItem.hide();
				}
				return;
			}

			const currentHash = this.generateMissingToolsHash(missingTools);
			const dismissedHashes = this.context.workspaceState.get<string[]>(
				"dismissedMissingToolsHashes",
				[],
			);

			if (dismissedHashes.includes(currentHash)) {
				if (this.missingToolBarItem) {
					this.missingToolBarItem.hide();
				}
				return;
			}

			if (!this.missingToolBarItem) {
				this.missingToolBarItem = vscode.window.createStatusBarItem(
					vscode.StatusBarAlignment.Left,
					0,
				);
			}
			const list = missingTools
				.map((tool) => tool.name + (tool.version ? ` (${tool.version})` : ""))
				.join(", ");

			this.missingToolBarItem.text = `Missing tools: ${truncateStr(list, 50)}`;
			this.missingToolBarItem.color = new vscode.ThemeColor("errorForeground");
			this.missingToolBarItem.show();

			this.missingToolBarItem.tooltip = "Mise: Click to install missing tools";
			this.missingToolBarItem.command = MISE_MISSING_TOOLS_MENU;
		});
	}

	private generateMissingToolsHash(tools: MiseTool[]) {
		const hash = createHash("sha256");
		tools.forEach((tool) => {
			hash.update(tool.name + (tool.version || ""));
		});
		return hash.digest("hex");
	}
}
