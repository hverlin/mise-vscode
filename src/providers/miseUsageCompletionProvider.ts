import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import {
	fileTaskConfigItems,
	findUsageStringStart,
	getEnclosingTaskUsageLines,
	getFileTaskConfigHoverInfo,
	getUsageCompletionItems,
	getUsageCursorContext,
	getUsageHoverInfo,
	getUsageVariableNames,
	isInsideQuotedString,
	type UsageCompletionItem,
} from "../utils/usageSpec";

const USAGE_COMMENT_RE = /^\s*#USAGE(?:\s(.*))?$/;
const MISE_COMMENT_RE = /^\s*#MISE\s/;

/**
 * The usage/config blocks are string (TOML) scopes where VS Code only shows
 * quick suggestions when `editor.quickSuggestions.strings` is enabled (done
 * via `configurationDefaults` for TOML). Space is registered as an explicit
 * trigger character so attribute completion also pops up right after a
 * directive is typed, and `$` so `$usage_*` variables pop up in run scripts.
 */
export const usageTriggerCharacters = [" ", "$"];

/** `$` or `${` followed by a partial variable name right before the cursor */
const VARIABLE_PREFIX_RE = /\$\{?[A-Za-z_]*$/;

async function isMiseTomlFile(
	miseService: MiseService,
	document: vscode.TextDocument,
): Promise<boolean> {
	if (!document.fileName.endsWith(".toml")) {
		return false;
	}

	const files = await miseService.getCurrentConfigFiles();
	if (files.includes(expandPath(document.uri.fsPath))) {
		return true;
	}

	return (
		/mise\.[^.]*\.?toml$/.test(document.fileName) ||
		document.fileName.endsWith("config.toml")
	);
}

/**
 * Completion for task argument definitions (https://usage.jdx.dev/spec/):
 * - usage spec directives inside `usage = '''...'''` blocks of TOML tasks
 * - usage spec directives after `#USAGE` in file tasks
 * - task configuration keys after `#MISE` in file tasks
 */
export class UsageCompletionProvider implements vscode.CompletionItemProvider {
	constructor(private miseService: MiseService) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	) {
		const linePrefix = document
			.lineAt(position)
			.text.substring(0, position.character);

		if (document.languageId === "shellscript") {
			const usageMatch = linePrefix.match(USAGE_COMMENT_RE);
			if (usageMatch) {
				// Preceding contiguous #USAGE lines form the same usage spec
				const previousLines: string[] = [];
				for (let lineNum = position.line - 1; lineNum >= 0; lineNum--) {
					const match = document.lineAt(lineNum).text.match(USAGE_COMMENT_RE);
					if (!match) {
						break;
					}
					previousLines.unshift(match[1] ?? "");
				}
				return buildCompletionItems(
					getUsageCompletionItems(
						getUsageCursorContext(previousLines, usageMatch[1] ?? ""),
					),
				);
			}
			if (/^\s*#MISE\s+[\w.]*$/.test(linePrefix)) {
				return buildCompletionItems(fileTaskConfigItems);
			}
			// `$usage_*` variables in the script body, from the #USAGE lines
			if (VARIABLE_PREFIX_RE.test(linePrefix)) {
				const specLines: string[] = [];
				for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
					const match = document.lineAt(lineNum).text.match(USAGE_COMMENT_RE);
					if (match) {
						specLines.push(match[1] ?? "");
					}
				}
				return buildVariableItems(getUsageVariableNames(specLines));
			}
			return undefined;
		}

		// Cheap checks first: the provider is invoked on every typed character
		const lines = document.getText().split("\n");
		const usageStart = findUsageStringStart(lines, position);
		if (usageStart === null) {
			// `$usage_*` variables in a run block, from the task's usage field
			if (VARIABLE_PREFIX_RE.test(linePrefix)) {
				const specLines = getEnclosingTaskUsageLines(lines, position);
				if (specLines && (await isMiseTomlFile(this.miseService, document))) {
					return buildVariableItems(getUsageVariableNames(specLines));
				}
			}
			return undefined;
		}

		if (!(await isMiseTomlFile(this.miseService, document))) {
			return undefined;
		}

		const previousLines = lines.slice(usageStart + 1, position.line);
		return buildCompletionItems(
			getUsageCompletionItems(
				getUsageCursorContext(
					previousLines,
					// On the opening `usage = '''` line only the part after the
					// quotes belongs to the usage spec
					usageStart === position.line
						? linePrefix.replace(/^\s*usage\s*=\s*('''|""")/, "")
						: linePrefix,
				),
			),
		);
	}
}

/**
 * Hover documentation for usage spec keywords (`arg`, `flag`, `choices`,
 * attributes, ...) inside usage blocks and `#USAGE` lines, and for task
 * configuration keys on `#MISE` lines.
 */
export class UsageHoverProvider implements vscode.HoverProvider {
	constructor(private miseService: MiseService) {}

	async provideHover(document: vscode.TextDocument, position: vscode.Position) {
		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}
		const word = document.getText(wordRange);
		const line = document.lineAt(position).text;

		// No hover for keywords appearing inside quoted values
		if (isInsideQuotedString(line.substring(0, wordRange.start.character))) {
			return undefined;
		}

		if (document.languageId === "shellscript") {
			if (USAGE_COMMENT_RE.test(line)) {
				return toHover(getUsageHoverInfo(word));
			}
			if (MISE_COMMENT_RE.test(line)) {
				return toHover(getFileTaskConfigHoverInfo(word));
			}
			return undefined;
		}

		const lines = document.getText().split("\n");
		if (findUsageStringStart(lines, position) === null) {
			return undefined;
		}
		if (!(await isMiseTomlFile(this.miseService, document))) {
			return undefined;
		}
		return toHover(getUsageHoverInfo(word));
	}
}

function toHover(info: string | undefined): vscode.Hover | undefined {
	return info ? new vscode.Hover(new vscode.MarkdownString(info)) : undefined;
}

function buildVariableItems(variables: string[]) {
	return variables.map((name) => {
		const item = new vscode.CompletionItem(
			`usage_${name}`,
			vscode.CompletionItemKind.Variable,
		);
		item.detail = `Value of the "${name}" arg/flag from the usage spec`;
		return item;
	});
}

function buildCompletionItems(items: UsageCompletionItem[]) {
	return items.map((item) => {
		const completion = new vscode.CompletionItem(
			item.name,
			vscode.CompletionItemKind.Property,
		);
		completion.detail = item.detail;
		completion.insertText = new vscode.SnippetString(item.insertText);
		if (item.documentation) {
			completion.documentation = new vscode.MarkdownString(item.documentation);
		}
		return completion;
	});
}
