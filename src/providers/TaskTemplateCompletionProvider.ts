import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	collectFileTaskTemplates,
	collectTaskTemplates,
	formatTaskTemplateDetail,
	formatTaskTemplateMarkdown,
	type TaskTemplate,
} from "../utils/taskTemplates";
import {
	isPositionInTasksContext,
	parseExtendsValuePrefix,
} from "../utils/tomlParsing";
import { MISE_COMMENT_RE } from "../utils/usageSpec";

/**
 * Completes the task template names of `extends = "<name>"`
 * (https://mise.jdx.dev/tasks/templates.html) with the templates declared in
 * the config file being edited and in its parent config files. File tasks
 * name their template in a `#MISE extends="<name>"` header line.
 */
export class TaskTemplateCompletionProvider
	implements vscode.CompletionItemProvider
{
	constructor(private miseService: MiseService) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		const linePrefix = document
			.lineAt(position.line)
			.text.slice(0, position.character);
		const extendsContext = parseExtendsValuePrefix(linePrefix);
		if (!extendsContext) {
			return [];
		}

		const isFileTask = document.languageId === "shellscript";
		if (
			isFileTask
				? !MISE_COMMENT_RE.test(linePrefix)
				: !document.fileName.endsWith(".toml") ||
					!isPositionInTasksContext(document, position)
		) {
			return [];
		}

		const templates = isFileTask
			? await collectFileTaskTemplates(this.miseService, document)
			: await collectTaskTemplates(
					document,
					(await this.miseService.getMiseConfigFiles()).map(
						(file) => file.path,
					),
				);

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
