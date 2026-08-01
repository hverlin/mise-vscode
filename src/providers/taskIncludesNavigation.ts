import path from "node:path";
import * as vscode from "vscode";
import { getCachedTomlParser } from "../utils/miseFileParser";

const CONFIG_FILE_CANDIDATES = [
	"mise.toml",
	"mise.local.toml",
	".mise.toml",
	"mise/config.toml",
	".mise/config.toml",
	".config/mise/config.toml",
];

async function findConfigFileIn(
	dir: vscode.Uri,
): Promise<vscode.Uri | undefined> {
	for (const candidate of CONFIG_FILE_CANDIDATES) {
		const uri = vscode.Uri.joinPath(dir, candidate);
		try {
			await vscode.workspace.fs.stat(uri);
			return uri;
		} catch {
			// try the next candidate
		}
	}
	return undefined;
}

/**
 * Links each literal entry of `[monorepo] config_roots` to the sub-project:
 * to its mise config file when one exists, otherwise to the folder in the
 * explorer. Glob entries (`projects/*`) and missing folders are skipped.
 */
async function getConfigRootLinks(
	document: vscode.TextDocument,
): Promise<vscode.DocumentLink[]> {
	const parser = getCachedTomlParser(document);
	const monorepo = (
		parser?.parsed as { monorepo?: Record<string, unknown> } | undefined
	)?.monorepo;
	if (!parser || !monorepo || !Array.isArray(monorepo.config_roots)) {
		return [];
	}

	let valueSource: { start: number; end: number };
	try {
		valueSource = parser.sourceTracker.getValueSource(monorepo, "config_roots");
	} catch {
		return [];
	}

	const baseDir = path.dirname(document.uri.fsPath);
	const arrayText = document
		.getText()
		.slice(valueSource.start, valueSource.end);
	const links: vscode.DocumentLink[] = [];

	for (const match of arrayText.matchAll(/["']([^"']+)["']/g)) {
		const configRoot = match[1];
		if (!configRoot) {
			continue;
		}

		const rootUri = vscode.Uri.file(path.join(baseDir, configRoot));
		try {
			const stat = await vscode.workspace.fs.stat(rootUri);
			if (!(stat.type & vscode.FileType.Directory)) {
				continue;
			}
		} catch {
			// glob patterns and folders that do not exist
			continue;
		}

		const configFile = await findConfigFileIn(rootUri);
		const link = new vscode.DocumentLink(
			new vscode.Range(
				document.positionAt(valueSource.start + match.index + 1),
				document.positionAt(
					valueSource.start + match.index + 1 + configRoot.length,
				),
			),
			configFile ??
				vscode.Uri.parse(
					`command:revealInExplorer?${encodeURIComponent(JSON.stringify(rootUri))}`,
				),
		);
		link.tooltip = configFile
			? "Open project config"
			: "Reveal folder in explorer";
		links.push(link);
	}

	return links;
}

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

			const [links, configRootLinks] = await Promise.all([
				Promise.all(linkPromises),
				getConfigRootLinks(document),
			]);
			return links.filter((link) => link !== null).concat(configRootLinks);
		},
	});

	context.subscriptions.push(linkProvider);
}
