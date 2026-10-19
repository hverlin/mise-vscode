import type { DocumentSelector } from "vscode";
import * as vscode from "vscode";
import { isTeraAutoCompletionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import {
	getTeraCompletionContext,
	getTeraHoverInformation,
	teraFilters,
	teraFunctions,
	teraKeywords,
	teraTests,
	teraVariables,
} from "./teraKeywords";

export class TeraCompletionProvider implements vscode.CompletionItemProvider {
	private miseService: MiseService;
	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token?: vscode.CancellationToken,
		completionContext?: vscode.CompletionContext,
	) {
		const lineText = document.lineAt(position).text;
		const linePrefix = lineText.substring(0, position.character);

		if (!isTeraAutoCompletionEnabled()) {
			return;
		}

		if (!document.fileName.endsWith(".toml")) {
			return;
		}

		// cheaper than finding whether a multiline string holds the position
		if (!this.isInTeraContext(linePrefix)) {
			return;
		}

		if (!this.isInTomlString(document, position)) {
			return;
		}

		const context = getTeraCompletionContext(linePrefix);
		// a space only triggers the tests after `is`, and the filters of
		// `{% filter %}`
		if (
			context === "attribute" ||
			context === "string" ||
			(completionContext?.triggerCharacter === " " && context === "expression")
		) {
			return;
		}

		const files = await this.miseService.getCurrentConfigFiles();
		if (!files.includes(expandPath(document.uri.fsPath))) {
			const isMiseTomlFile =
				/mise\.[^.]*\.?toml$/.test(document.fileName) ||
				document.fileName.endsWith("config.toml");
			if (!isMiseTomlFile) {
				return;
			}
		}

		const stringContext = this.getStringContext(lineText, position.character);
		const withInsertText = (
			item: vscode.CompletionItem,
			insertText?: string,
		) => {
			if (insertText) {
				item.insertText = new vscode.SnippetString(
					this.adjustInsertText(insertText, stringContext),
				);
			}
			return item;
		};

		if (context === "filter") {
			return teraFilters.map((f) => {
				const item = new vscode.CompletionItem(
					f.name,
					vscode.CompletionItemKind.Method,
				);
				item.detail = f.detail;
				return withInsertText(item, f.insertText);
			});
		}

		if (context === "test") {
			const items = teraTests.map((t) => {
				const item = new vscode.CompletionItem(
					t.name,
					vscode.CompletionItemKind.Method,
				);
				item.detail = t.detail;
				return withInsertText(item, t.insertText);
			});
			if (!/\bnot\s+\w*$/.test(linePrefix)) {
				items.push(
					new vscode.CompletionItem("not", vscode.CompletionItemKind.Keyword),
				);
			}
			return items;
		}

		return [
			...teraVariables.map((v) => {
				const item = new vscode.CompletionItem(v.name, v.kind);
				item.detail = v.detail;
				return item;
			}),
			...teraFunctions.map((f) => {
				const item = new vscode.CompletionItem(
					f.name,
					vscode.CompletionItemKind.Function,
				);
				item.detail = f.detail;
				item.documentation = f.documentation;
				return withInsertText(item, f.insertText);
			}),
			...teraKeywords.map((k) => new vscode.CompletionItem(k.name, k.kind)),
		];
	}

	private isInTomlString(
		document: vscode.TextDocument,
		position: vscode.Position,
	): boolean {
		const line = document.lineAt(position).text;

		let inSingleQuote = false;
		let inDoubleQuote = false;
		let inMultiSingleQuote = false;
		let inMultiDoubleQuote = false;

		for (let i = 0; i < position.character; i++) {
			const char = line[i];
			const nextChars = line.slice(i, i + 3);

			if (
				nextChars === "'''" &&
				!inDoubleQuote &&
				!inSingleQuote &&
				!inMultiDoubleQuote
			) {
				inMultiSingleQuote = !inMultiSingleQuote;
				i += 2;
				continue;
			}

			if (
				nextChars === '"""' &&
				!inSingleQuote &&
				!inDoubleQuote &&
				!inMultiSingleQuote
			) {
				inMultiDoubleQuote = !inMultiDoubleQuote;
				i += 2;
				continue;
			}

			if (
				char === "'" &&
				!inDoubleQuote &&
				!inMultiSingleQuote &&
				!inMultiDoubleQuote
			) {
				inSingleQuote = !inSingleQuote;
				continue;
			}

			if (
				char === '"' &&
				!inSingleQuote &&
				!inMultiSingleQuote &&
				!inMultiDoubleQuote
			) {
				inDoubleQuote = !inDoubleQuote;
				continue;
			}

			if (char === "\\" && i + 1 < line.length) {
				i++;
			}
		}

		if (
			inSingleQuote ||
			inDoubleQuote ||
			inMultiSingleQuote ||
			inMultiDoubleQuote
		) {
			return true;
		}

		// try to check if we are in a multiline string
		let lineNum = position.line;
		while (lineNum > 0) {
			const line = document.lineAt(lineNum).text;
			if (!line.includes("=") && line.match(/('''|""")/)) {
				return false;
			}
			if (line.match(/=\s*('''|""")/)) {
				return true;
			}
			lineNum--;
		}

		return false;
	}

	private getStringContext(
		line: string,
		position: number,
	): { quote: string; hasExistingQuotes: boolean } {
		let currentQuote = "";
		let hasExistingQuotes = false;

		for (let i = 0; i < position; i++) {
			const char = line[i];
			const nextChars = line.slice(i, i + 3);

			if (nextChars === "'''" || nextChars === '"""') {
				currentQuote = nextChars;
				i += 2;
			} else if (char === "'" || char === '"') {
				currentQuote = char;
			}
		}

		const teraExprStart = line.lastIndexOf("{{", position);
		if (teraExprStart !== -1) {
			const textBeforeCursor = line.substring(teraExprStart, position);
			hasExistingQuotes = /\w+\s*=\s*["']/.test(textBeforeCursor);
		}

		return { quote: currentQuote, hasExistingQuotes };
	}

	private adjustInsertText(
		insertText: string,
		stringContext: { quote: string; hasExistingQuotes: boolean },
	): string {
		if (!insertText.includes('="')) {
			return insertText;
		}

		if (stringContext.hasExistingQuotes) {
			return insertText.replace(/="([^"]*)"/g, "=$1");
		}

		if (stringContext.quote === '"' || stringContext.quote === '"""') {
			return insertText.replace(/="([^"]*)"/g, "='$1'");
		}

		return insertText;
	}

	private isInTeraContext(linePrefix: string): boolean {
		return /\{\{[^}]*$/.test(linePrefix) || /\{%[^%]*$/.test(linePrefix);
	}
}

/** Whether a position is between `{{` and `}}`, or `{%` and `%}`, on its line */
const isInsideTeraExpression = (
	document: vscode.TextDocument,
	position: vscode.Position,
): boolean => {
	const line = document.lineAt(position.line).text;
	const before = line.slice(0, position.character);
	const after = line.slice(position.character);
	return (
		[
			["{{", "}}"],
			["{%", "%}"],
		] as const
	).some(([open, close]) => {
		const opened = before.lastIndexOf(open);
		return (
			opened !== -1 &&
			!before.slice(opened).includes(close) &&
			after.includes(close)
		);
	});
};

export const createTeraHoverProvider = (
	documentSelector: DocumentSelector,
	miseService: MiseService,
) =>
	vscode.languages.registerHoverProvider(documentSelector, {
		async provideHover(
			document: vscode.TextDocument,
			position: vscode.Position,
		) {
			if (!isTeraAutoCompletionEnabled()) {
				return undefined;
			}

			if (!isInsideTeraExpression(document, position)) {
				return undefined;
			}

			const files = await miseService.getCurrentConfigFiles();
			if (!files.includes(expandPath(document.uri.fsPath))) {
				const isMiseTomlFile =
					/mise\.[^.]*\.?toml$/.test(document.fileName) ||
					document.fileName.endsWith("config.toml");
				if (!isMiseTomlFile) {
					return;
				}
			}

			const wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return undefined;
			}

			const line = document.lineAt(position.line).text;
			const info = getTeraHoverInformation(
				document.getText(wordRange),
				line.slice(0, wordRange.start.character),
				line.slice(wordRange.end.character),
			);
			return info ? new vscode.Hover([info], wordRange) : undefined;
		},
	});
