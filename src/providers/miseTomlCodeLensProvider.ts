import * as toml from "@iarna/toml";
import * as vscode from "vscode";
import { RUN_TASK_COMMAND, WATCH_TASK_COMMAND } from "./tasksProvider";

export class MiseTomlCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> =
		this._onDidChangeCodeLenses.event;

	constructor() {
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.fileName.endsWith(".toml")) {
				this._onDidChangeCodeLenses.fire();
			}
		});
	}

	public async provideCodeLenses(
		document: vscode.TextDocument,
	): Promise<vscode.CodeLens[]> {
		if (
			!document.fileName.includes("mise") ||
			!document.fileName.endsWith(".toml")
		) {
			return [];
		}

		const codeLenses: vscode.CodeLens[] = [];
		const text = document.getText();

		try {
			const parsed = toml.parse(text);
			const tasks = this.findTasks(parsed);

			for (const taskName of tasks) {
				const taskPosition = this.findTaskPosition(document, taskName);
				if (taskPosition) {
					const range = new vscode.Range(
						taskPosition,
						taskPosition.translate(0, taskName.length),
					);

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
				}
			}
		} catch (error) {
			console.error("Error parsing TOML:", error);
		}

		return codeLenses;
	}

	private findTasks(parsed: toml.JsonMap): string[] {
		const tasks: string[] = [];

		// Case 1: [tasks] section with inline tasks
		if (parsed.tasks && typeof parsed.tasks === "object") {
			tasks.push(...Object.keys(parsed.tasks));
		}

		// Case 2: [tasks.taskname] style
		for (const key of Object.keys(parsed)) {
			if (key.startsWith("tasks.")) {
				const taskName = key.split(".")[1];
				if (taskName) {
					tasks.push(taskName);
				}
			}
		}

		return tasks;
	}

	private findTaskPosition(
		document: vscode.TextDocument,
		taskName: string,
	): vscode.Position | undefined {
		const text = document.getText();
		const lines = text.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Case 1: Check for [tasks] section with inline tasks
			if (line.trim().match(new RegExp(`${taskName}\\s*=`))) {
				return new vscode.Position(i, line.indexOf(taskName));
			}

			// Case 2: Check for [tasks.taskname] style
			if (line.trim() === `[tasks.${taskName}]`) {
				return new vscode.Position(i, line.indexOf(taskName));
			}
		}

		return undefined;
	}
}
