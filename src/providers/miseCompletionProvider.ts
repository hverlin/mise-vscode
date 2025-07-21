import type {
	CancellationToken,
	CompletionContext,
	Position,
	TextDocument,
} from "vscode";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";

export class MiseCompletionProvider implements vscode.CompletionItemProvider {
	private tasksCache: MiseTask[];
	constructor(private miseService: MiseService) {
		this.tasksCache = [];
	}

	async provideCompletionItems(
		document: TextDocument,
		position: Position,
		_token: CancellationToken,
		context: CompletionContext,
	) {
		const lineText = document.lineAt(position.line).text;
		if (!this.isDependsArrayContext(lineText, position.character)) {
			return [];
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
				completionItem.insertText =
					context.triggerCharacter === '"' || context.triggerCharacter === "'"
						? task.name
						: `"${task.name}"`;
				return completionItem;
			})
			.filter((item) => item.insertText);
	}

	private isDependsArrayContext(lineText: string, position: number): boolean {
		const dependsMatch = /(depends|wait_for|depends_post)\s*=/.test(lineText);
		if (!dependsMatch) {
			return false;
		}

		if (lineText.includes("]")) {
			const arrayStart = lineText.indexOf("[", lineText.indexOf("depends"));
			const arrayEnd = lineText.indexOf("]", arrayStart);

			return position > arrayStart && position <= arrayEnd;
		}

		const arrayStart = lineText.indexOf("[", lineText.indexOf("depends"));
		return position > arrayStart;
	}
}
