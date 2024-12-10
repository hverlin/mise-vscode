import * as vscode from "vscode";
import type { DocumentSelector } from "vscode";
import { isTeraAutoCompletionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { logger } from "../utils/logger";
import {
	teraFilters,
	teraFunctions,
	teraHoverInformation,
	teraKeywords,
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
	) {
		const lineText = document.lineAt(position).text;
		const linePrefix = lineText.substring(0, position.character);

		if (!isTeraAutoCompletionEnabled()) {
			return;
		}

		if (!document.fileName.endsWith(".toml")) {
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

		if (!this.isInTomlString(document, position)) {
			return;
		}

		if (!this.isInTeraContext(linePrefix)) {
			return;
		}

		const items: vscode.CompletionItem[] = [];
		const stringContext = this.getStringContext(lineText, position.character);

		if (this.shouldProvideVariables(linePrefix)) {
			items.push(
				...teraVariables.map((v) => {
					const item = new vscode.CompletionItem(v.name, v.kind);
					item.detail = v.detail;
					return item;
				}),
			);
		}

		if (this.shouldProvideFunctions(linePrefix)) {
			items.push(
				...teraFunctions.map((f) => {
					const item = new vscode.CompletionItem(
						f.name,
						vscode.CompletionItemKind.Function,
					);
					item.detail = f.detail;
					item.documentation = f.documentation;
					if (f.insertText) {
						const adjustedInsertText = this.adjustInsertText(
							f.insertText,
							stringContext,
						);
						item.insertText = new vscode.SnippetString(adjustedInsertText);
					}
					return item;
				}),
			);
		}

		if (this.shouldProvideFilters(linePrefix)) {
			items.push(
				...teraFilters.map((f) => {
					const item = new vscode.CompletionItem(
						f.name,
						vscode.CompletionItemKind.Method,
					);
					item.detail = f.detail;
					if (f.insertText) {
						const adjustedInsertText = this.adjustInsertText(
							f.insertText,
							stringContext,
						);
						item.insertText = new vscode.SnippetString(adjustedInsertText);
					}
					return item;
				}),
			);
		}

		if (this.shouldProvideKeywords(linePrefix)) {
			items.push(
				...teraKeywords.map((k) => {
					return new vscode.CompletionItem(k.name, k.kind);
				}),
			);
		}

		return items;
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

	private shouldProvideVariables(linePrefix: string): boolean {
		return (
			!linePrefix.trimEnd().endsWith("|") && !linePrefix.trimEnd().endsWith(".")
		);
	}

	private shouldProvideFunctions(linePrefix: string): boolean {
		return (
			!linePrefix.trimEnd().endsWith("|") && !linePrefix.trimEnd().endsWith(".")
		);
	}

	private shouldProvideFilters(linePrefix: string): boolean {
		return linePrefix.trimEnd().endsWith("|");
	}

	private shouldProvideKeywords(linePrefix: string): boolean {
		if (
			linePrefix.trimEnd().endsWith("|") ||
			linePrefix.trimEnd().endsWith(".")
		) {
			return false;
		}

		return /\{%[^%]*$/.test(linePrefix) || /\{\{[^}]*$/.test(linePrefix);
	}
}

const isInsideTeraExpression = (
	document: vscode.TextDocument,
	position: vscode.Position,
): boolean => {
	const line = document.lineAt(position.line).text;
	let openBraceIndex = -1;
	let closeBraceIndex = -1;

	for (let i = position.character; i >= 0; i--) {
		if (line.substring(i - 1, i + 1) === "{{") {
			openBraceIndex = i - 1;
			break;
		}
	}

	for (let i = position.character; i < line.length - 1; i++) {
		if (line.substring(i, i + 2) === "}}") {
			closeBraceIndex = i;
			break;
		}
	}

	return (
		openBraceIndex !== -1 &&
		closeBraceIndex !== -1 &&
		position.character > openBraceIndex &&
		position.character < closeBraceIndex
	);
};

export const createHoverProvider = (
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

			const word = document.getText(wordRange);

			const info = teraHoverInformation.get(word);
			if (info) {
				return new vscode.Hover([info]);
			}
			return undefined;
		},
	});
