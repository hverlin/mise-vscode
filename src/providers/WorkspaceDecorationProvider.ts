import * as vscode from "vscode";
import { getCurrentWorkspaceFolderPath } from "../configuration";

export class WorkspaceDecorationProvider
	implements vscode.FileDecorationProvider
{
	private readonly context: vscode.ExtensionContext;
	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	private _onDidChangeFileDecorations: vscode.EventEmitter<
		vscode.Uri | undefined
	> = new vscode.EventEmitter<vscode.Uri | undefined>();
	readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | undefined> =
		this._onDidChangeFileDecorations.event;

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if ((vscode.workspace.workspaceFolders?.length || 0) <= 1) {
			return undefined;
		}

		const currentWorkspaceFolderPath = getCurrentWorkspaceFolderPath(
			this.context,
		);
		if (uri.fsPath === currentWorkspaceFolderPath) {
			return {
				badge: "●",
				color: new vscode.ThemeColor("charts.foreground"),
				tooltip: "Mise workspace",
			};
		}

		return undefined;
	}

	refresh() {
		this._onDidChangeFileDecorations.fire(undefined);
	}
}
