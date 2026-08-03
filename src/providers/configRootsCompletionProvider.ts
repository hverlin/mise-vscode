import path from "node:path";
import type {
	CancellationToken,
	CompletionContext,
	Position,
	TextDocument,
} from "vscode";
import * as vscode from "vscode";
import { getConfigRootsArrayContext } from "../utils/tomlParsing";

const IGNORED_DIR_NAMES = new Set(["node_modules", "target", "dist", "out"]);

/**
 * Completes directory paths inside `[monorepo] config_roots = [...]`.
 * Suggests one path segment at a time (typing `/` triggers the next level)
 * plus a `*` glob entry — config_roots supports single-level globs only.
 */
export class ConfigRootsCompletionProvider
	implements vscode.CompletionItemProvider
{
	async provideCompletionItems(
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
		_context: CompletionContext,
	) {
		const arrayContext = getConfigRootsArrayContext(document, position);
		if (!arrayContext) {
			return [];
		}

		const { inQuote, partial } = arrayContext;
		const lastSlash = partial.lastIndexOf("/");
		const parentRel = lastSlash === -1 ? "" : partial.slice(0, lastSlash);
		if (parentRel.includes("*")) {
			return [];
		}

		const baseDir = path.dirname(document.uri.fsPath);
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(
				vscode.Uri.file(path.join(baseDir, parentRel)),
			);
		} catch {
			return [];
		}

		// inside a string the completion replaces the path segment being typed;
		// a bare token is replaced entirely with the full quoted path
		const replacedLength = inQuote
			? partial.length - (lastSlash + 1)
			: partial.length;
		const replaceRange = new vscode.Range(
			position.line,
			position.character - replacedLength,
			position.line,
			position.character,
		);
		const toItem = (name: string) => {
			const item = new vscode.CompletionItem(
				name,
				vscode.CompletionItemKind.Folder,
			);
			if (inQuote) {
				item.insertText = name;
			} else {
				const fullPath = parentRel ? `${parentRel}/${name}` : name;
				item.insertText = `"${fullPath}"`;
				item.filterText = fullPath;
			}
			item.range = replaceRange;
			return item;
		};

		const items = entries
			.filter(
				([name, type]) =>
					type & vscode.FileType.Directory &&
					!name.startsWith(".") &&
					!IGNORED_DIR_NAMES.has(name),
			)
			.map(([name]) => toItem(name));

		if (items.length) {
			const globItem = toItem("*");
			globItem.detail = "All direct subdirectories";
			// sort after the concrete directory names
			globItem.sortText = "~";
			items.push(globItem);
		}

		return items;
	}
}
