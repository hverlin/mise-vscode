import os from "node:os";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import {
	type MiseTomlType,
	TomlParser,
	findTaskDefinition,
} from "../utils/miseFileParser";
import { DEPENDS_KEYWORDS } from "../utils/miseUtilts";

export class TaskDefinitionProvider implements vscode.DefinitionProvider {
	private miseService: MiseService;
	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	public async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.LocationLink[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		const tasks = await this.miseService.getTasks({ includeHidden: true });
		const tasksSources = tasks.map((t) => expandPath(t.source));
		if (!tasksSources.includes(document.uri.fsPath)) {
			return [];
		}

		const tomParser = new TomlParser<MiseTomlType>(document.getText());

		const keyAtPosition = tomParser.getKeyAtPosition(position);
		const keyPath = keyAtPosition?.key ?? [];
		if (!keyPath.length) {
			return [];
		}

		if (!DEPENDS_KEYWORDS.includes(keyPath.at(-1) || "")) {
			return [];
		}

		const taskNameRange = document.getWordRangeAtPosition(position, /[\w:-]+/);
		if (!taskNameRange) {
			return [];
		}

		const taskName = document.getText(taskNameRange);

		const task = tasks.find((t) => t.name === taskName);
		if (!task) {
			return [];
		}

		const uri = vscode.Uri.file(task.source.replace(/^~/, os.homedir()));
		const taskDocument = await vscode.workspace.openTextDocument(uri);

		const foundPosition = findTaskDefinition(taskDocument, task.name);

		return [
			{
				originSelectionRange: taskNameRange,
				targetUri: vscode.Uri.parse(task.source),
				targetSelectionRange: new vscode.Range(
					foundPosition.start,
					foundPosition.end,
				),
				targetRange: new vscode.Range(
					foundPosition.start,
					foundPosition.end.translate(100, 100), // hack to make the range visible, improve later
				),
			},
		];
	}
}
