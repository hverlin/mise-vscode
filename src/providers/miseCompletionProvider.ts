import type {
	CancellationToken,
	CompletionContext,
	Position,
	TextDocument,
} from "vscode";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import {
	getTaskNameValueContext,
	isPositionInToolsContext,
} from "../utils/tomlParsing";

export class MiseCompletionProvider implements vscode.CompletionItemProvider {
	private tasksCache: MiseTask[];
	constructor(private miseService: MiseService) {
		this.tasksCache = [];
	}

	async provideCompletionItems(
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
		_context: CompletionContext,
	) {
		const valueContext = getTaskNameValueContext(document, position);
		if (!valueContext) {
			return [];
		}
		// the name completes the string the cursor is in, or brings its own
		const asValue = (name: string) =>
			valueContext.inQuote ? name : `"${name}"`;

		// `depends` on a tool (in a [tools.*] section or a tool's inline options
		// table) refers to other tools, not tasks
		const toolsContext = isPositionInToolsContext(document, position);
		if (toolsContext.inContext) {
			const tools = await this.miseService.getCurrentTools();
			const toolNames = [
				...new Set(
					tools
						.map((tool) => tool.name)
						.filter((name) => name !== toolsContext.sectionToolName),
				),
			];
			return toolNames.map((name) => {
				const completionItem = new vscode.CompletionItem(
					name,
					vscode.CompletionItemKind.Module,
				);
				completionItem.insertText = asValue(name);
				return completionItem;
			});
		}

		const tasks = await this.miseService.getTasks({ includeHidden: true });
		if (!this.tasksCache.length && tasks.length) {
			this.tasksCache = tasks;
		}

		return this.tasksCache
			.map((task) => {
				const completionItem = new vscode.CompletionItem(
					task.name,
					vscode.CompletionItemKind.Value,
				);
				if (task.description) {
					completionItem.documentation = new vscode.MarkdownString(
						task.description,
					);
				}
				completionItem.insertText = asValue(task.name);
				return completionItem;
			})
			.filter((item) => item.insertText);
	}
}
