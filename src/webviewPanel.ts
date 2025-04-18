import { readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";
import * as vscode from "vscode";
import { MISE_EDIT_SETTING } from "./commands";
import type { MiseService } from "./miseService";
import { logger } from "./utils/logger";

type PanelView = "TOOLS" | "SETTINGS" | "TRACKED_CONFIGS" | "TASKS_DEPS";

function panelTitleForView(view: PanelView) {
	switch (view) {
		case "TOOLS":
			return "Tools";
		case "SETTINGS":
			return "Settings";
		case "TRACKED_CONFIGS":
			return "Tracked Configs";
		case "TASKS_DEPS":
			return "Tasks Dependencies";
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
			);
		}
	}

	private constructor(
		_extContext: vscode.ExtensionContext,
		column: vscode.ViewColumn,
		miseService: MiseService,
		view: PanelView,
	) {
		this._extContext = _extContext;
		this._extensionUri = _extContext.extensionUri;
		this.miseService = miseService;
		this.view = view;

		this._panel = vscode.window.createWebviewPanel(
			WebViewPanel.viewType,
			`Mise: ${panelTitleForView(this.view)}`,
			column,
			{
				retainContextWhenHidden: false,
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
									this.miseService.getOutdatedTools(),
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
							case "taskDeps": {
								return executeAction(message, () =>
									this.miseService.getTaskDependencies(message.variables.tasks),
								);
							}
							case "tasks": {
								return executeAction(message, () =>
									this.miseService.getTasks(),
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
									miseService.upgradeToolInConsole(message.mutationKey[1]),
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

		return $.html();
	}
}
