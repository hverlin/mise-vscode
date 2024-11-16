import * as path from "node:path";
import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath, isExecutable } from "../utils/fileUtils";
import { RUN_TASK_COMMAND, WATCH_TASK_COMMAND } from "./tasksProvider";

export class MiseFileTaskCodeLensProvider implements vscode.CodeLensProvider {
	constructor(private miseService: MiseService) {}

	public async provideCodeLenses(
		document: vscode.TextDocument,
	): Promise<vscode.CodeLens[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		const tasks = await this.miseService.getTasks();
		const codeLenses: vscode.CodeLens[] = [];
		const existingTask = tasks.find((t) => {
			if (t.name === path.basename(document.fileName)) {
				return true;
			}

			return expandPath(t.source) === expandPath(document.fileName);
		});

		if (!((await isExecutable(document.fileName)) && existingTask)) {
			return [];
		}

		const range = new vscode.Range(
			new vscode.Position(0, 0),
			new vscode.Position(0, 0),
		);

		codeLenses.push(
			new vscode.CodeLens(range, {
				title: "$(play) Run",
				tooltip: `Run task ${existingTask.name}`,
				command: RUN_TASK_COMMAND,
				arguments: [existingTask.name],
			}),
		);
		codeLenses.push(
			new vscode.CodeLens(range, {
				title: "$(watch) Watch",
				tooltip: `Watch task ${existingTask.name}`,
				command: WATCH_TASK_COMMAND,
				arguments: [existingTask.name],
			}),
		);
		return codeLenses;
	}
}
