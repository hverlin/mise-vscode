import { readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";
import * as vscode from "vscode";
import {
	MISE_EDIT_SETTING,
	MISE_OPEN_BOOTSTRAP_ENTRY_DEFINITION,
	MISE_OPEN_TASK_DEFINITION,
	MISE_RUN_TASK,
} from "./commands";
import type { MiseService } from "./miseService";
import { displayPathRelativeTo, expandPath } from "./utils/fileUtils";
import { logger } from "./utils/logger";
import {
	getTaskConfigRoot,
	getTaskDependencyEdges,
	getTaskDisplayName,
} from "./utils/taskNames";

type PanelView = "TOOLS" | "SETTINGS" | "TASKS_DEPS" | "BOOTSTRAP" | "PROJECTS";

function panelTitleForView(view: PanelView) {
	switch (view) {
		case "TOOLS":
			return "Tools";
		case "SETTINGS":
			return "Settings";
		case "TASKS_DEPS":
			return "Tasks Dependencies";
		case "BOOTSTRAP":
			return "Bootstrap";
		case "PROJECTS":
			return "Projects";
	}
}

export default class WebViewPanel {
	public static currentPanels: Record<string, WebViewPanel> = {};
	private static readonly viewType = "Mise";

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private readonly _extContext: vscode.ExtensionContext;
	private _disposables: vscode.Disposable[] = [];
	private readonly miseService: MiseService;
	private readonly view: PanelView = "TOOLS";

	public static createOrShow(
		extContext: vscode.ExtensionContext,
		miseService: MiseService,
		view: PanelView,
		options: { flatFileView?: boolean } = {},
	) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (WebViewPanel.currentPanels[view]) {
			WebViewPanel.currentPanels[view]._panel.reveal(column);
		} else {
			WebViewPanel.currentPanels[view] = new WebViewPanel(
				extContext,
				vscode.ViewColumn.One,
				miseService,
				view,
				options,
			);
		}
	}

	private readonly options: { flatFileView?: boolean };

	private constructor(
		_extContext: vscode.ExtensionContext,
		column: vscode.ViewColumn,
		miseService: MiseService,
		view: PanelView,
		options: { flatFileView?: boolean } = {},
	) {
		this._extContext = _extContext;
		this._extensionUri = _extContext.extensionUri;
		this.miseService = miseService;
		this.view = view;
		this.options = options;

		this._panel = vscode.window.createWebviewPanel(
			WebViewPanel.viewType,
			`Mise: ${panelTitleForView(this.view)}`,
			column,
			{
				// keep the graph state (selection, filters, viewport) when the
				// panel is hidden behind another editor tab
				retainContextWhenHidden: this.view === "TASKS_DEPS",
				enableScripts: true,
				localResourceRoots: [this._extensionUri],
			},
		);

		this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		const executeAction = async (
			{ requestId }: { requestId: string },
			fn: () => Promise<unknown>,
		) => {
			try {
				const data = await fn();
				this._panel.webview.postMessage({
					type: "response",
					requestId,
					data,
				});
			} catch (e) {
				logger.info(e);
				this._panel.webview.postMessage({
					type: "response",
					requestId,
					error: e,
				});
			}
		};

		this._panel.webview.onDidReceiveMessage(
			async (message) => {
				switch (message.type) {
					case "query":
						switch (message.queryKey[0]) {
							case "tools": {
								return executeAction(message, () =>
									this.miseService.getAllTools(),
								);
							}
							case "outdatedTools": {
								return executeAction(message, () =>
									this.miseService.getOutdatedTools({
										bump: message.variables?.bump === true,
									}),
								);
							}
							case "settings": {
								return executeAction(message, () =>
									this.miseService.getSettings(),
								);
							}
							case "settingsSchema": {
								return executeAction(message, () =>
									this.miseService.getSettingsSchema(),
								);
							}
							case "trackedConfigs": {
								return executeAction(message, () =>
									this.miseService.getTrackedConfigFiles(),
								);
							}
							case "projects": {
								return executeAction(message, () =>
									this.miseService.getProjects(),
								);
							}
							case "tasksGraph": {
								return executeAction(message, async () => {
									const projects = await this.miseService.getTasksGraph();
									const workspaceRoot =
										this.miseService.getCurrentWorkspaceFolderPath();
									return projects.map((project) => ({
										...project,
										// absolute path of the manifest the project was inferred
										// from, so the webview can open it
										manifestPath:
											workspaceRoot && project.provenance?.source
												? expandPath(
														path.join(workspaceRoot, project.provenance.source),
													)
												: undefined,
									}));
								});
							}
							case "taskFlowGraph": {
								return executeAction(message, async () => {
									const [tasks, projects] = await Promise.all([
										this.miseService.getAllCachedTasks(),
										this.miseService.getTasksGraph(),
									]);
									const workspaceRoot =
										this.miseService.getCurrentWorkspaceFolderPath();
									return {
										tasks: tasks.map((task) => {
											// group key: the config root in a monorepo, otherwise
											// the directory of the source file
											const configRoot = getTaskConfigRoot(task);
											const sourceDir = path.dirname(expandPath(task.source));
											return {
												...task,
												displayName: getTaskDisplayName(task),
												sourceLabel: displayPathRelativeTo(
													task.source,
													workspaceRoot,
												),
												projectKey: configRoot ?? sourceDir,
												projectLabel:
													configRoot ||
													(configRoot === ""
														? "monorepo root"
														: displayPathRelativeTo(sourceDir, workspaceRoot) ||
															"."),
											};
										}),
										edges: getTaskDependencyEdges(tasks, projects),
									};
								});
							}
							case "tasks": {
								return executeAction(message, () =>
									this.miseService.getTasks(),
								);
							}
							case "bootstrapStatus": {
								return executeAction(message, () =>
									this.miseService.getBootstrapStatus(),
								);
							}
						}
						break;
					case "mutation":
						switch (message.mutationKey[0]) {
							case "uninstallTool": {
								return executeAction(message, async () =>
									miseService.removeToolInConsole(
										message.mutationKey[1],
										message.mutationKey[2],
									),
								);
							}
							case "pruneTools": {
								return executeAction(message, async () =>
									miseService.pruneToolsInConsole(),
								);
							}
							case "upgradeTool": {
								return executeAction(message, async () =>
									miseService.upgradeToolInConsole(message.mutationKey[1], {
										bump: message.variables?.bump === true,
									}),
								);
							}
							case "installTool": {
								return executeAction(message, async () =>
									miseService.installToolInConsole(
										message.mutationKey[1],
										message.mutationKey[2],
									),
								);
							}
							case "openFile": {
								return executeAction(message, async () =>
									vscode.window.showTextDocument(
										vscode.Uri.file(message.variables?.path as string),
										{ preview: true, viewColumn: vscode.ViewColumn.One },
									),
								);
							}
							case "addProjectScanDirectory": {
								return executeAction(message, async () => {
									const picked = await vscode.window.showOpenDialog({
										canSelectFolders: true,
										canSelectFiles: false,
										canSelectMany: false,
										openLabel: "Scan folder",
										title: "Select a folder to scan for mise projects",
									});
									const dir = picked?.[0]?.fsPath;
									if (dir) {
										await this.miseService.addProjectScanDirectory(dir);
									}
									return dir ?? null;
								});
							}
							case "removeProjectScanDirectory": {
								return executeAction(message, async () =>
									this.miseService.removeProjectScanDirectory(
										message.variables?.path as string,
									),
								);
							}
							case "openProjectInNewWindow": {
								return executeAction(message, async () =>
									vscode.commands.executeCommand(
										"vscode.openFolder",
										vscode.Uri.file(message.variables?.path as string),
										{ forceNewWindow: true },
									),
								);
							}
							case "openTaskDefinition": {
								return executeAction(message, async () => {
									const tasks = await this.miseService.getAllCachedTasks();
									const task = tasks.find(
										(t) => t.name === message.variables?.taskName,
									);
									if (task) {
										await vscode.commands.executeCommand(
											MISE_OPEN_TASK_DEFINITION,
											task,
										);
									}
								});
							}
							case "toggleMaximizedEditor": {
								return executeAction(message, async () =>
									vscode.commands.executeCommand(
										"workbench.action.toggleMaximizeEditorGroup",
									),
								);
							}
							case "runTask": {
								return executeAction(message, async () =>
									vscode.commands.executeCommand(
										MISE_RUN_TASK,
										message.variables?.taskName,
									),
								);
							}
							case "openBootstrapEntryDefinition": {
								return executeAction(message, async () =>
									vscode.commands.executeCommand(
										MISE_OPEN_BOOTSTRAP_ENTRY_DEFINITION,
										message.variables?.entry,
									),
								);
							}
							case "runBootstrap": {
								return executeAction(message, async () =>
									miseService.runBootstrapInConsole({
										dryRun: message.variables?.dryRun === true,
									}),
								);
							}
							case "editSetting": {
								return executeAction(message, async () =>
									vscode.commands.executeCommand(
										MISE_EDIT_SETTING,
										message.variables?.key,
									),
								);
							}
						}
						break;
				}
			},
			undefined,
			this._extContext.subscriptions,
		);

		vscode.workspace
			.createFileSystemWatcher(
				new vscode.RelativePattern(this._extensionUri, "dist/webviews/*"),
			)
			.onDidChange(() => {
				void vscode.commands.executeCommand(
					"workbench.action.webview.reloadWebviewAction",
				);
			});

		miseService.subscribeToReloadEvent(() => {
			this._panel.webview.postMessage({
				type: "invalidateQueries",
				requestId: "invalidateQueries",
				data: null,
			});
		});
	}

	public dispose() {
		for (const view in WebViewPanel.currentPanels) {
			if (WebViewPanel.currentPanels[view] === this) {
				delete WebViewPanel.currentPanels[view];
			}
		}
		this._panel.dispose();
		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const basePath = vscode.Uri.joinPath(
			this._extensionUri,
			"dist",
			"webviews",
		);
		const htmlContent = readFileSync(
			path.join(basePath.fsPath, "index.html"),
			"utf-8",
		);
		const $ = cheerio.load(htmlContent);

		$("script").each((_, element) => {
			const src = $(element).attr("src");
			if (src && !src.startsWith("http")) {
				const scriptUri = webview.asWebviewUri(
					vscode.Uri.joinPath(basePath, src),
				);
				$(element).attr("src", scriptUri.toString());
			}
		});

		$('link[rel="stylesheet"]').each((_, element) => {
			const href = $(element).attr("href");
			if (!(href && !href.startsWith("http"))) {
				return;
			}

			$(element).attr(
				"href",
				webview.asWebviewUri(vscode.Uri.joinPath(basePath, href)).toString(),
			);

			const cssPath = path.join(basePath.fsPath, href);
			try {
				const cssContent = readFileSync(cssPath, "utf-8");
				const processedCss = cssContent.replace(
					/url\(['"]?([^'")]+)['"]?\)/g,
					(match, url) => {
						if (url.startsWith("http")) {
							return match;
						}

						return `url("${webview
							.asWebviewUri(vscode.Uri.joinPath(basePath, url))
							.toString()}")`;
					},
				);
				writeFileSync(cssPath, processedCss);
			} catch (error) {
				logger.error("Error processing CSS file:", error);
			}
		});

		$("img").each((_, element) => {
			const src = $(element).attr("src");
			if (!(src && !src?.startsWith("http"))) {
				return;
			}
			$(element).attr(
				"src",
				webview.asWebviewUri(vscode.Uri.joinPath(basePath, src)).toString(),
			);
		});

		$("head")
			.append(`<meta name="view" content="${this.view}">`)
			.append(`<meta name="homeDir" content="${os.homedir()}">`);

		if (this.options.flatFileView) {
			$("head").append(`<meta name="flatFileView" content="true">`);
		}

		return $.html();
	}
}
