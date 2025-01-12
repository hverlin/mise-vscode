import micromatch from "micromatch";
import type { Position, TextDocument } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { findTaskDefinition } from "../utils/miseFileParser";
import { DEPENDS_KEYWORDS } from "../utils/miseUtilts";

// https://mise.jdx.dev/tasks/running-tasks.html#wildcards
function isTaskDependency(task: MiseTask, taskName: string): boolean {
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

			const taskMatch = micromatch.isMatch(taskName, pattern, {
				dot: true,
				nobrace: false, // Enable {a,b} matching
				noglobstar: false, // Enable ** matching
			});
			if (taskMatch) {
				return true;
			}
		}
	}

	return false;
}

export async function getReferencesForTask(
	taskName: string,
	tasks: MiseTask[],
) {
	const task = tasks.find((t) => t.name === taskName);
	if (!task) {
		return [];
	}

	const tasksReference = tasks.filter((t) => isTaskDependency(t, taskName));

	return await Promise.all(
		tasksReference.map(async (task) => {
			const taskDocument = await vscode.workspace.openTextDocument(
				vscode.Uri.parse(expandPath(task.source)),
			);

			const taskPosition = findTaskDefinition(taskDocument, task.name);

			return {
				uri: vscode.Uri.parse(expandPath(task.source)),
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
			document.getWordRangeAtPosition(position, /[\w:-]+/),
		);

		return getReferencesForTask(
			word,
			await this.miseService.getAllCachedTasks(),
		);
	}
}
