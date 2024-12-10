import path from "node:path";
import * as vscode from "vscode";

export function registerTomlFileLinks(context: vscode.ExtensionContext) {
	const linkProvider = vscode.languages.registerDocumentLinkProvider("toml", {
		async provideDocumentLinks(document: vscode.TextDocument) {
			const text = document.getText();
			const regex = /["']([^"']*\.[a-z]+)["']/g;
			const matches = Array.from(text.matchAll(regex));
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

			if (!workspaceFolder) {
				return [];
			}

			const linkPromises = matches.map(async (match) => {
				const filePath = match[1];
				if (!filePath) {
					return null;
				}

				const absolutePath = path.join(workspaceFolder.uri.fsPath, filePath);
				const uri = vscode.Uri.file(absolutePath);

				try {
					await vscode.workspace.fs.stat(uri);
					const startPos = document.positionAt(match.index + 1);
					const endPos = document.positionAt(match.index + filePath.length + 1);
					const range = new vscode.Range(startPos, endPos);
					return new vscode.DocumentLink(range, uri);
				} catch {
					return null;
				}
			});

			const links = await Promise.all(linkPromises);
			return links.filter((link) => link !== null);
		},
	});

	context.subscriptions.push(linkProvider);
}
