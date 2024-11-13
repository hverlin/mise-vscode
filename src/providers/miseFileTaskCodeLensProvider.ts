import * as path from "node:path";
import * as vscode from "vscode";
import { isExecutable } from "../utils/fileUtils";
import { logger } from "../utils/logger";
import { RUN_TASK_COMMAND, WATCH_TASK_COMMAND } from "./tasksProvider";

export class MiseFileTaskCodeLensProvider implements vscode.CodeLensProvider {
	public async provideCodeLenses(
		document: vscode.TextDocument,
	): Promise<vscode.CodeLens[]> {
		const codeLenses: vscode.CodeLens[] = [];
		logger.info(`provideCodeLenses: ${document.fileName}`);
		if (!(await isExecutable(document.fileName))) {
			return [];
		}

		const range = new vscode.Range(
			new vscode.Position(0, 0),
			new vscode.Position(0, 0),
		);

		const taskName = path.basename(document.fileName);
		codeLenses.push(
			new vscode.CodeLens(range, {
				title: "$(play) Run",
				tooltip: `Run task ${taskName}`,
				command: RUN_TASK_COMMAND,
				arguments: [taskName],
			}),
		);
		codeLenses.push(
			new vscode.CodeLens(range, {
				title: "$(watch) Watch",
				tooltip: `Watch task ${taskName}`,
				command: WATCH_TASK_COMMAND,
				arguments: [taskName],
			}),
		);
		return codeLenses;
	}
}