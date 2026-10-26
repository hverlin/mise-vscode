import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { collectFileTaskTemplates } from "../utils/taskTemplates";
import {
	fileTaskConfigItems,
	findUsageStringStart,
	getEnclosingTaskUsageLines,
	getEnclosingTaskUsageSpec,
	getFileTaskConfigHoverInfo,
	getSectionUsageSpec,
	getUsageCompletionItems,
	getUsageCursorContext,
	getUsageHoverInfo,
	getUsageVariableAt,
	getUsageVariableNames,
	isInsideQuotedString,
	MISE_COMMENT_RE,
	parseFileTaskExtends,
	parseUsageDeclaration,
	type UsageCompletionItem,
	type UsageDeclaration,
} from "../utils/usageSpec";

const USAGE_COMMENT_RE = /^\s*#\s*(?:USAGE|\[USAGE\])(?:\s(.*))?$/;

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
			if (/^\s*#\s*(?:MISE|\[MISE\])\s+[\w.]*$/.test(linePrefix)) {
				return buildCompletionItems(fileTaskConfigItems);
			}
			// `$usage_*` variables in the script body, from the #USAGE lines and,
			// with mise 2026.10.19+, the usage of the template the task extends
			if (VARIABLE_PREFIX_RE.test(linePrefix)) {
				const specLines: string[] = [];
				let templateName: string | undefined;
				for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
					const text = document.lineAt(lineNum).text;
					const match = text.match(USAGE_COMMENT_RE);
					if (match) {
						specLines.push(match[1] ?? "");
					}
					templateName ??= parseFileTaskExtends(text);
				}
				if (templateName) {
					specLines.unshift(
						...(await this.getTemplateUsageLines(document, templateName)),
					);
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

	/** The `usage` lines of the template a file task extends */
	private async getTemplateUsageLines(
		document: vscode.TextDocument,
		templateName: string,
	): Promise<string[]> {
		try {
			const template = (
				await collectFileTaskTemplates(this.miseService, document)
			).find(({ name }) => name === templateName);
			const usage = template?.fields.usage;
			return typeof usage === "string" ? usage.split("\n") : [];
		} catch {
			// e.g. a config that does not parse: the #USAGE lines still complete
			return [];
		}
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

/** Where a `$usage_*` variable is declared */
type UsageVariableDeclaration = {
	targetUri: vscode.Uri;
	targetRange: vscode.Range;
	targetSelectionRange: vscode.Range;
	/** the `arg` or `flag`, unknown when only the template is found */
	usage?: UsageDeclaration;
	/** the template whose usage declares the variable */
	templateName?: string;
};

/**
 * Go to definition and hover for a `$usage_*` variable, from the `arg` or
 * `flag` declaring it: in a file task, its `#USAGE` lines, then the usage of
 * the template it extends; in a TOML task, its `usage` field.
 */
export class UsageVariableProvider
	implements vscode.DefinitionProvider, vscode.HoverProvider
{
	constructor(private miseService: MiseService) {}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.LocationLink[] | undefined> {
		const resolved = await this.resolve(document, position);
		if (!resolved) {
			return undefined;
		}
		const { targetUri, targetRange, targetSelectionRange } =
			resolved.declaration;
		return [
			{
				originSelectionRange: resolved.range,
				targetUri,
				targetRange,
				targetSelectionRange,
			},
		];
	}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Hover | undefined> {
		const resolved = await this.resolve(document, position);
		if (!resolved) {
			return undefined;
		}
		const { declaration, name } = resolved;

		const source = declaration.templateName
			? `the usage of the \`${declaration.templateName}\` template`
			: document.languageId === "shellscript"
				? "the `#USAGE` lines"
				: "the `usage` of the task";
		const markdown = new vscode.MarkdownString();
		if (declaration.usage) {
			const { kind, help } = declaration.usage;
			markdown.appendMarkdown(
				`\`usage_${name}\`: value of the \`${declaration.usage.declaration.slice(1, -1)}\` ${kind === "arg" ? "argument" : "flag"}, from ${source}`,
			);
			if (help) {
				markdown.appendMarkdown("\n\n");
				markdown.appendText(help);
			}
		} else {
			markdown.appendMarkdown(`\`usage_${name}\`: from ${source}`);
		}
		if (declaration.targetUri.fsPath !== document.uri.fsPath) {
			markdown.appendMarkdown(
				`\n\nDeclared in [${vscode.workspace.asRelativePath(declaration.targetUri)}](${declaration.targetUri}#L${declaration.targetSelectionRange.start.line + 1})`,
			);
		}
		return new vscode.Hover(markdown, resolved.range);
	}

	/** The variable at the position, and its declaration */
	private async resolve(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<
		| {
				name: string;
				range: vscode.Range;
				declaration: UsageVariableDeclaration;
		  }
		| undefined
	> {
		if (!isMiseExtensionEnabled()) {
			return undefined;
		}

		const variable = getUsageVariableAt(
			document.lineAt(position).text,
			position.character,
		);
		if (!variable) {
			return undefined;
		}
		const range = new vscode.Range(
			position.line,
			variable.start,
			position.line,
			variable.end,
		);
		const declaration = await this.findDeclaration(
			document,
			position,
			variable.name,
		);
		return declaration && { name: variable.name, range, declaration };
	}

	private async findDeclaration(
		document: vscode.TextDocument,
		position: vscode.Position,
		name: string,
	): Promise<UsageVariableDeclaration | undefined> {
		if (document.languageId === "shellscript") {
			let templateName: string | undefined;
			for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
				const text = document.lineAt(lineNum).text;
				const spec = text.match(USAGE_COMMENT_RE)?.[1];
				const declaration =
					spec === undefined
						? undefined
						: findDeclarationOnLine(document, lineNum, spec, name);
				if (declaration) {
					return declaration;
				}
				templateName ??= parseFileTaskExtends(text);
			}
			return templateName
				? this.findTemplateDeclaration(document, templateName, name)
				: undefined;
		}

		const lines = document.getText().split("\n");
		const specLines = getEnclosingTaskUsageSpec(lines, position);
		if (!specLines || !(await isMiseTomlFile(this.miseService, document))) {
			return undefined;
		}
		for (const { line, text } of specLines) {
			const declaration = findDeclarationOnLine(document, line, text, name);
			if (declaration) {
				return declaration;
			}
		}
		return undefined;
	}

	/**
	 * The declaration in the `usage` of a template, or the template itself
	 * when the usage is not in a `[task_templates.<name>]` table of its own
	 */
	private async findTemplateDeclaration(
		document: vscode.TextDocument,
		templateName: string,
		name: string,
	): Promise<UsageVariableDeclaration | undefined> {
		try {
			const template = (
				await collectFileTaskTemplates(this.miseService, document)
			).find((candidate) => candidate.name === templateName);
			if (typeof template?.fields.usage !== "string") {
				return undefined;
			}

			const templateDocument = await vscode.workspace.openTextDocument(
				vscode.Uri.file(template.source),
			);
			const headerLine = template.headerRange.start.line;
			if (/^\s*\[/.test(templateDocument.lineAt(headerLine).text)) {
				const lines = templateDocument.getText().split("\n");
				for (const { line, text } of getSectionUsageSpec(
					lines,
					headerLine + 1,
				)) {
					const declaration = findDeclarationOnLine(
						templateDocument,
						line,
						text,
						name,
					);
					if (declaration) {
						return { ...declaration, templateName };
					}
				}
			}
			if (
				!getUsageVariableNames(template.fields.usage.split("\n")).includes(name)
			) {
				return undefined;
			}
			return {
				targetUri: templateDocument.uri,
				targetRange: template.headerRange,
				targetSelectionRange: template.nameRange,
				templateName,
			};
		} catch {
			// e.g. a config that does not parse
			return undefined;
		}
	}
}

/** The `arg` or `flag` of `name`, when the spec line on `line` declares it */
function findDeclarationOnLine(
	document: vscode.TextDocument,
	line: number,
	spec: string,
	name: string,
): UsageVariableDeclaration | undefined {
	const declaration = parseUsageDeclaration(spec);
	if (declaration?.name !== name) {
		return undefined;
	}
	const lineRange = document.lineAt(line).range;
	const start = document.lineAt(line).text.indexOf(declaration.declaration);
	return {
		targetUri: document.uri,
		targetRange: lineRange,
		targetSelectionRange:
			start === -1
				? lineRange
				: new vscode.Range(
						line,
						start,
						line,
						start + declaration.declaration.length,
					),
		usage: declaration,
	};
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
		if (item.triggerSuggest) {
			completion.command = {
				command: "editor.action.triggerSuggest",
				title: "Suggest values",
			};
		}
		return completion;
	});
}
