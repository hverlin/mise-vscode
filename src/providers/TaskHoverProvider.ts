import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { type MiseTomlType, TomlParser } from "../utils/miseFileParser";
import { isDependsKeyword, isMiseTomlFile } from "../utils/miseUtilts";
import {
	findTasksMatchingDependsPattern,
	resolveTaskReference,
	TASK_NAME_REGEX,
	TASK_PATTERN_REGEX,
} from "../utils/taskNames";

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

function createTaskListMarkdownString(
	pattern: string,
	tasks: MiseTask[],
): vscode.MarkdownString {
	const markdownString = new vscode.MarkdownString();
	markdownString.appendMarkdown(
		`**${pattern}** matches ${tasks.length} tasks:\n\n`,
	);
	markdownString.appendMarkdown(
		tasks
			.map(
				(task) =>
					`- \`${task.name}\`${task.description ? ` — ${task.description}` : ""}`,
			)
			.join("\n"),
	);
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
		const documentPath = expandPath(document.uri.fsPath);
		const tasksSources = tasks.map((t) => expandPath(t.source));
		if (!tasksSources.includes(documentPath)) {
			return null;
		}

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
			const taskNameRange = document.getWordRangeAtPosition(
				position,
				TASK_NAME_REGEX,
			);
			if (!taskNameRange) {
				return null;
			}

			// the parsed key handles quoted names like `[tasks."docs:build"]`
			const localName = String(keyPath.at(-1));
			const task = resolveTaskReference(tasks, localName, documentPath);
			if (!task) {
				return null;
			}

			return new vscode.Hover(createMarkdownString(task), taskNameRange);
		}

		if (!isDependsKeyword(keyPath.at(-1) || "")) {
			return null;
		}

		const patternRange = document.getWordRangeAtPosition(
			position,
			TASK_PATTERN_REGEX,
		);
		if (!patternRange) {
			return null;
		}

		const pattern = document.getText(patternRange);
		const matchingTasks = findTasksMatchingDependsPattern(
			tasks,
			pattern,
			documentPath,
		);

		const [firstTask] = matchingTasks;
		if (!firstTask) {
			return null;
		}

		if (matchingTasks.length === 1) {
			return new vscode.Hover(createMarkdownString(firstTask), patternRange);
		}

		return new vscode.Hover(
			createTaskListMarkdownString(pattern, matchingTasks),
			patternRange,
		);
	}
}
