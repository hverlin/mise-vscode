import * as vscode from "vscode";
import {
	fileTaskSnippets,
	getFileTaskSnippetPosition,
	getTomlSnippetPosition,
	type MiseSnippet,
	tomlSnippets,
} from "../utils/miseSnippets";
import { isFileTaskPath, isMiseConfigPath } from "../utils/miseUtilts";

export type MiseSnippetProviderOptions = {
	isEnabled: () => boolean;
	/**
	 * Whether mise itself loads this file, for the ones the name does not give
	 * away: a config file included from another one, or a file task in a
	 * directory added through `task_config.includes`. Not available on the web,
	 * where there is no mise binary to ask.
	 */
	isTrackedByMise?: (document: vscode.TextDocument) => Promise<boolean>;
};

/**
 * Task snippets for mise config files and file tasks.
 *
 * They are provided here rather than through `contributes.snippets` because
 * that contribution can only be scoped to a language: it would offer
 * `[tasks.name]` in every TOML file of the workspace, and offer it in the
 * middle of a string or of an array, where it cannot be inserted.
 */
export class MiseSnippetProvider implements vscode.CompletionItemProvider {
	constructor(private readonly options: MiseSnippetProviderOptions) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | undefined> {
		if (!this.options.isEnabled()) {
			return undefined;
		}

		// contributed snippets used to be hidden by this editor setting, and the
		// suggest widget does not apply it to what a provider returns
		const snippetSuggestions = vscode.workspace
			.getConfiguration("editor", document)
			.get<string>("snippetSuggestions");
		if (snippetSuggestions === "none") {
			return undefined;
		}

		const isToml = document.languageId === "toml";

		// cheap checks first: the provider runs on every typed character
		const snippetPosition = isToml
			? getTomlSnippetPosition(document, position)
			: getFileTaskSnippetPosition(document, position);
		if (!snippetPosition) {
			return undefined;
		}

		const matchesMiseFileName = isToml
			? isMiseConfigPath(document.uri.path)
			: isFileTaskPath(document.uri.path);
		if (
			!matchesMiseFileName &&
			!(await this.options.isTrackedByMise?.(document))
		) {
			return undefined;
		}

		const range = new vscode.Range(
			position.line,
			snippetPosition.replaceStart,
			position.line,
			position.character,
		);
		const typed = document.getText(range);
		const snippets = isToml ? tomlSnippets : fileTaskSnippets;

		return snippets.map((snippet, index) =>
			buildCompletionItem(
				snippet,
				range,
				typed,
				isToml ? "toml" : "shell",
				index,
			),
		);
	}
}

function buildCompletionItem(
	snippet: MiseSnippet,
	range: vscode.Range,
	typed: string,
	language: string,
	index: number,
): vscode.CompletionItem {
	const item = new vscode.CompletionItem(
		snippet.prefix,
		vscode.CompletionItemKind.Snippet,
	);
	item.detail = snippet.description;
	item.documentation = new vscode.MarkdownString().appendCodeblock(
		snippet.body,
		language,
	);
	item.insertText = new vscode.SnippetString(snippet.body);
	item.range = range;
	// keep the snippets in the order they are declared in, from the plainest to
	// the most complete, rather than alphabetically. The `mise-task` stem keeps
	// them where their label would have put them, next to each other and not
	// ahead of what the toml schema suggests
	item.sortText = `mise-task${String(index).padStart(2, "0")}`;
	// the `[` of `[tas` and the `#` of `#mi` are replaced by the snippet, so
	// they have to be part of what the typed text is filtered against
	const openingChar =
		typed.startsWith("[") || typed.startsWith("#") ? typed[0] : "";
	item.filterText = `${openingChar}${snippet.prefix}`;
	return item;
}
