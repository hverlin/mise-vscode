import * as vscode from "vscode";
import {
	MISE_INSTALL_ALL,
	MISE_LIST_ALL_TOOLS,
	MISE_RUN_TASK,
	MISE_SHOW_SETTINGS,
	MISE_USE_TOOL,
	MISE_WATCH_TASK,
} from "../commands";
import { isCodeLensEnabled, isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";

function createRunTaskCodeLens(
	taskName: string,
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(play) Run",
		tooltip: `Run task ${taskName}`,
		command: MISE_RUN_TASK,
		arguments: [taskName],
	});
}

function createWatchTaskCodeLens(
	taskName: string,
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(watch) Watch",
		tooltip: `Watch task ${taskName}`,
		command: MISE_WATCH_TASK,
		arguments: [taskName],
	});
}

function createRunAndWatchTaskCodeLens(
	taskName: string,
	range: vscode.Range,
): vscode.CodeLens[] {
	return [
		createRunTaskCodeLens(taskName, range),
		createWatchTaskCodeLens(taskName, range),
	];
}

function createAddToolCodeLens(
	range: vscode.Range,
	filePath: string,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(add) Add tool",
		tooltip: "Add tool",
		command: MISE_USE_TOOL,
		arguments: [filePath],
	});
}

function addListToolsCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(list-unordered) List tools",
		tooltip: "List tools",
		command: MISE_LIST_ALL_TOOLS,
		arguments: [],
	});
}

function addSettingsListCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(gear) Manage settings",
		tooltip: "Manage settings",
		command: MISE_SHOW_SETTINGS,
		arguments: [],
	});
}

function createInstallMissingToolsCodeLens(
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(cloud-download) Install missing tools",
		tooltip: "Install missing tools",
		command: MISE_INSTALL_ALL,
	});
}

export class MiseTomlCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> =
		this._onDidChangeCodeLenses.event;

	constructor(private miseService: MiseService) {
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (!isMiseExtensionEnabled()) {
				return;
			}

			if (!isCodeLensEnabled()) {
				return;
			}

			if (e.document.fileName.endsWith(".toml")) {
				this._onDidChangeCodeLenses.fire();
			}
		});
	}

	private handleInTasksSection(i: number, lineContent: string) {
		const trimmedLine = lineContent.trim();
		const inlineName = trimmedLine.split("=")[0]?.trim();
		if (
			inlineName &&
			!inlineName.includes(".") &&
			!inlineName.startsWith("[")
		) {
			const taskName = inlineName.replace(/^["']|["']$/g, "");

			const startPos = new vscode.Position(i, lineContent.indexOf(taskName));
			const endPos = startPos.translate(0, taskName.length);
			return createRunAndWatchTaskCodeLens(
				taskName,
				new vscode.Range(startPos, endPos),
			);
		}

		return [];
	}

	private handleTaskFile(document: vscode.TextDocument): vscode.CodeLens[] {
		// we are already in a [tasks] section so valid patterns are
		// abc = '333' or "lint:test" = '333'
		// [abc] or ["lint:ci"]
		// run = '333'
		const codeLenses: vscode.CodeLens[] = [];
		const lines = document.getText().split("\n");

		let inTasksSection = true;
		for (let i = 0; i < lines.length; i++) {
			const lineContent = lines[i];
			if (!lineContent) {
				continue;
			}
			const trimmedLine = lineContent.trim();
			if (!trimmedLine) continue;

			if (/\[.*]/.test(trimmedLine)) {
				inTasksSection = false;
			}

			if (inTasksSection) {
				codeLenses.push(...this.handleInTasksSection(i, lineContent));
			} else {
				const match = trimmedLine.match(/^\s*\[["']?(.*)["']?]/);

				if (match) {
					const taskName = match[1] || match[2] || match[3];

					if (taskName) {
						const taskPosition = lineContent.indexOf(taskName);
						const startPos = new vscode.Position(i, taskPosition);
						const endPos = startPos.translate(0, taskName.length);
						codeLenses.push(
							...createRunAndWatchTaskCodeLens(
								taskName,
								new vscode.Range(startPos, endPos),
							),
						);
					}
				}
			}
		}
		return codeLenses;
	}

	private async handleMiseTomlFile(document: vscode.TextDocument) {
		const codeLenses: vscode.CodeLens[] = [];
		const lines = document.getText().split("\n");

		let inTasksSection = false;

		for (let i = 0; i < lines.length; i++) {
			const lineContent = lines[i];
			if (!lineContent) {
				continue;
			}
			const trimmedLine = lineContent.trim();
			if (!trimmedLine) continue;

			if (trimmedLine.trim().startsWith("[settings]")) {
				const range = new vscode.Range(
					new vscode.Position(i, 0),
					new vscode.Position(i, 0),
				);
				codeLenses.push(addSettingsListCodeLens(range));
			}

			if (trimmedLine.trim().startsWith("[tools]")) {
				const range = new vscode.Range(
					new vscode.Position(i, 0),
					new vscode.Position(i, 0),
				);
				codeLenses.push(createAddToolCodeLens(range, document.uri.path));
				codeLenses.push(addListToolsCodeLens(range));
				if (await this.miseService.hasMissingTools()) {
					codeLenses.push(createInstallMissingToolsCodeLens(range));
				}
			}

			// Check if we're entering [tasks] section
			if (trimmedLine === "[tasks]") {
				inTasksSection = true;
				continue;
			}

			// Check if we're leaving [tasks] section (entering a new section)
			if (trimmedLine.startsWith("[") && trimmedLine !== "[tasks]") {
				inTasksSection = false;
			}

			const match = trimmedLine.match(
				/^\s*\[tasks\.(?:["']([^"']+)["']|([^\]]+))\]/,
			);
			// tasks.aaa = '3'
			const match2 = trimmedLine.match(
				/^\s*tasks\.["']?(.*)["']?\s*=\s*['"]?(.*)['"]?/,
			);

			if (match || match2) {
				const taskName = match
					? match[1] || match[2] || match[3]
					: match2
						? match2[1]
						: null;

				if (taskName) {
					const taskPosition = lineContent.indexOf(taskName);
					const startPos = new vscode.Position(i, taskPosition);
					const endPos = startPos.translate(0, taskName.length);
					codeLenses.push(
						...createRunAndWatchTaskCodeLens(
							taskName,
							new vscode.Range(startPos, endPos),
						),
					);
				}
			} else if (inTasksSection) {
				codeLenses.push(...this.handleInTasksSection(i, lineContent));
			}
		}

		return codeLenses;
	}

	public async provideCodeLenses(
		document: vscode.TextDocument,
	): Promise<vscode.CodeLens[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		if (!isCodeLensEnabled()) {
			return [];
		}

		if (!document.fileName.endsWith(".toml")) {
			return [];
		}

		const files = await this.miseService.getCurrentConfigFiles();
		if (!files.includes(expandPath(document.uri.fsPath))) {
			return [];
		}

		const isMiseTomlFile =
			/mise\.[^.]*\.?toml$/.test(document.fileName) ||
			document.fileName.endsWith("config.toml");

		if (isMiseTomlFile) {
			return await this.handleMiseTomlFile(document);
		}

		return this.handleTaskFile(document);
	}
}
