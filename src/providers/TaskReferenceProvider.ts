import type { Position, TextDocument } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { findTaskDefinition } from "../utils/miseFileParser";
import { DEPENDS_KEYWORDS } from "../utils/miseUtilts";
import {
	dependsPatternMatchesTask,
	getTaskNameParts,
	resolveTaskReference,
	TASK_NAME_REGEX,
} from "../utils/taskNames";

// https://mise.jdx.dev/tasks/running-tasks.html#wildcards
function isTaskDependency(task: MiseTask, target: MiseTask): boolean {
	const ownerConfigRoot = getTaskNameParts(task.name).configRoot;

	for (const keyword of DEPENDS_KEYWORDS) {
		const depends = task[keyword];
		if (!depends) {
			continue;
		}

		for (const depend of depends) {
			const pattern = typeof depend === "string" ? depend : depend[0];
			if (!pattern) {
				continue;
			}

			if (dependsPatternMatchesTask(pattern, ownerConfigRoot, target)) {
				return true;
			}
		}
	}

	return false;
}

export async function getReferencesForTask(task: MiseTask, tasks: MiseTask[]) {
	const tasksReference = tasks.filter((t) => isTaskDependency(t, task));

	return await Promise.all(
		tasksReference.map(async (dependentTask) => {
			const taskDocument = await vscode.workspace.openTextDocument(
				vscode.Uri.parse(expandPath(dependentTask.source)),
			);

			const taskPosition = findTaskDefinition(taskDocument, dependentTask.name);

			return {
				uri: vscode.Uri.parse(expandPath(dependentTask.source)),
				range: new vscode.Range(
					new vscode.Position(
						taskPosition.start.line,
						taskPosition.start.character,
					),
					new vscode.Position(
						taskPosition.end.line,
						taskPosition.end.character,
					),
				),
			};
		}),
	);
}

export class TaskReferenceProvider implements vscode.ReferenceProvider {
	private miseService: MiseService;
	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	async provideReferences(
		document: TextDocument,
		position: Position,
	): Promise<vscode.Location[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		const word = document.getText(
			document.getWordRangeAtPosition(position, TASK_NAME_REGEX),
		);

		const tasks = await this.miseService.getAllCachedTasks();
		const task = resolveTaskReference(
			tasks,
			word,
			expandPath(document.uri.fsPath),
		);
		if (!task) {
			return [];
		}

		return getReferencesForTask(task, tasks);
	}
}
