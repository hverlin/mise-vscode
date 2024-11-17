import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import * as vscode from "vscode";
import type { MiseService } from "./miseService";
import { logger } from "./utils/logger";

export default class WebViewPanel {
	public static currentPanel: WebViewPanel | undefined;
	private static readonly viewType = "MiseTools";

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private readonly _extContext: vscode.ExtensionContext;
	private _disposables: vscode.Disposable[] = [];
	private readonly miseService: MiseService;

	public static createOrShow(
		extContext: vscode.ExtensionContext,
		miseService: MiseService,
	) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (WebViewPanel.currentPanel) {
			WebViewPanel.currentPanel._panel.reveal(column);
		} else {
			WebViewPanel.currentPanel = new WebViewPanel(
				extContext,
				vscode.ViewColumn.Two,
				miseService,
			);
		}
	}

	private constructor(
		_extContext: vscode.ExtensionContext,
		column: vscode.ViewColumn,
		miseService: MiseService,
	) {
		this._extContext = _extContext;
		this._extensionUri = _extContext.extensionUri;
		this.miseService = miseService;

		this._panel = vscode.window.createWebviewPanel(
			WebViewPanel.viewType,
			"MiseTools",
			column,
			{ enableScripts: true, localResourceRoots: [this._extensionUri] },
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
	}

	public dispose() {
		WebViewPanel.currentPanel = undefined;
		this._panel.dispose();
		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const html = readFileSync(
			path.join(this._extensionUri.path, "dist", "webviews", "index.html"),
			"utf-8",
		);

		const $ = cheerio.load(html);

		$("script").each((_, element) => {
			const src = $(element).attr("src");
			if (src && !src.startsWith("http")) {
				const scriptUri = webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "dist", "webviews", src),
				);
				$(element).attr("src", scriptUri.toString());
			}
		});

		$('link[rel="stylesheet"]').each((_, element) => {
			const href = $(element).attr("href");
			if (href && !href.startsWith("http")) {
				const styleUri = webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "dist", "webviews", href),
				);
				$(element).attr("href", styleUri.toString());
			}
		});

		$("img").each((_, element) => {
			const src = $(element).attr("src");
			if (src && !src.startsWith("http")) {
				const imageUri = webview.asWebviewUri(
					vscode.Uri.joinPath(this._extensionUri, "dist", "webviews", src),
				);
				$(element).attr("src", imageUri.toString());
			}
		});

		return $.html();
	}
}
