import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	collectTaskTemplates,
	formatTaskTemplateDetail,
	formatTaskTemplateMarkdown,
	type TaskTemplate,
} from "../utils/taskTemplates";
import {
	isPositionInTasksContext,
	parseExtendsValuePrefix,
} from "../utils/tomlParsing";

/**
 * Completes the task template names of `extends = "<name>"`
 * (https://mise.jdx.dev/tasks/templates.html) with the templates declared in
 * the config file being edited and in its parent config files.
 */
export class TaskTemplateCompletionProvider
	implements vscode.CompletionItemProvider
{
	constructor(private miseService: MiseService) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[]> {
		if (!isMiseExtensionEnabled() || !document.fileName.endsWith(".toml")) {
			return [];
		}

		const linePrefix = document
			.lineAt(position.line)
			.text.slice(0, position.character);
		const extendsContext = parseExtendsValuePrefix(linePrefix);
		if (!extendsContext || !isPositionInTasksContext(document, position)) {
			return [];
		}

		const configPaths = (await this.miseService.getMiseConfigFiles()).map(
			(file) => file.path,
		);
		const templates = await collectTaskTemplates(document, configPaths);

		// the name may hold `:` and `/`, which are not word characters: replacing
		// an explicit range keeps what was already typed from being duplicated
		const replaceRange = new vscode.Range(
			position.translate(0, -extendsContext.partial.length),
			position,
		);

		return templates.map((template) =>
			this.createCompletionItem(
				template,
				document,
				extendsContext.quote,
				replaceRange,
			),
		);
	}

	private createCompletionItem(
		template: TaskTemplate,
		document: vscode.TextDocument,
		quote: string,
		replaceRange: vscode.Range,
	): vscode.CompletionItem {
		const item = new vscode.CompletionItem(
			template.name,
			vscode.CompletionItemKind.Interface,
		);
		item.detail = formatTaskTemplateDetail(template);
		item.documentation = formatTaskTemplateMarkdown(template, {
			header: false,
		});
		item.insertText = quote ? template.name : `"${template.name}"`;
		item.range = replaceRange;

		const source =
			template.source === document.uri.fsPath
				? "this file"
				: vscode.workspace.asRelativePath(template.source);
		item.documentation.appendMarkdown(`\n\nDeclared in \`${source}\``);

		return item;
	}
}
