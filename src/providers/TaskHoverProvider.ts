import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { type MiseTomlType, TomlParser } from "../utils/miseFileParser";
import { isDependsKeyword, isMiseTomlFile } from "../utils/miseUtilts";

function createMarkdownString(task: MiseTask): vscode.MarkdownString {
	const markdownString = new vscode.MarkdownString();
	markdownString.supportHtml = true;
	markdownString.appendMarkdown(`**${task.name}**`);
	if (task.description) {
		markdownString.appendMarkdown(`<br />${task.description}`);
	}
	if (task.run) {
		markdownString.appendCodeblock(task.run?.join("\n") || "", "shell");
	}
	if (task.file) {
		markdownString.appendMarkdown(`\n\nFile: ${task.file}`);
	}
	return markdownString;
}

export class TaskHoverProvider implements vscode.HoverProvider {
	private miseService: MiseService;
	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	public async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Hover | null> {
		if (!isMiseExtensionEnabled()) {
			return null;
		}

		const tasks = await this.miseService.getAllCachedTasks();
		const tasksSources = tasks.map((t) => expandPath(t.source));
		if (!tasksSources.includes(document.uri.fsPath)) {
			return null;
		}

		const taskNameRange = document.getWordRangeAtPosition(position, /[\w:-]+/);
		if (!taskNameRange) {
			return null;
		}

		const taskName = document.getText(taskNameRange);
		const tomParser = new TomlParser<MiseTomlType>(document.getText());

		const keyAtPosition = tomParser.getKeyAtPosition(position);
		const keyPath = keyAtPosition?.key ?? [];
		if (!keyPath.length) {
			return null;
		}

		if (
			(keyPath.length === 1 && !isMiseTomlFile(document.fileName)) ||
			(keyPath.length === 2 && keyPath[0] === "tasks")
		) {
			const task = tasks.find((t) => t.name === taskName);
			if (!task) {
				return null;
			}

			return new vscode.Hover(createMarkdownString(task), taskNameRange);
		}

		if (!isDependsKeyword(keyPath.at(-1) || "")) {
			return null;
		}

		const task = tasks.find((t) => t.name === taskName);
		if (!task) {
			return null;
		}

		return new vscode.Hover(createMarkdownString(task), taskNameRange);
	}
}
