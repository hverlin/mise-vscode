import type { Position, TextDocument } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { findTaskDefinition } from "../utils/miseFileParser";

export async function getReferencesForTask(
	taskName: string,
	tasks: MiseTask[],
) {
	const task = tasks.find((t) => t.name === taskName);
	if (!task) {
		return [];
	}

	const tasksReference = tasks.filter((t) => {
		return (
			t.depends?.includes(task.name) ||
			t.depends_post?.includes(task.name) ||
			t.wait_for?.includes(task.name)
		);
	});

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

		return getReferencesForTask(word, await this.miseService.getTasks());
	}
}
