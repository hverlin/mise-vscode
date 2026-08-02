import os from "node:os";
import vscode, { type Definition } from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import {
	findTaskDefinition,
	findTaskTemplatePosition,
	getCachedTomlParser,
} from "../utils/miseFileParser";
import { isDependsKeyword, isMiseTomlFile } from "../utils/miseUtilts";
import {
	findTasksMatchingDependsPattern,
	resolveTaskReference,
	TASK_NAME_REGEX,
	TASK_PATTERN_REGEX,
} from "../utils/taskNames";

export class TaskDefinitionProvider implements vscode.DefinitionProvider {
	private miseService: MiseService;
	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	public async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.LocationLink[] | Definition | null> {
		if (!isMiseExtensionEnabled()) {
			return null;
		}

		const tasks = await this.miseService.getAllCachedTasks();
		const documentPath = expandPath(document.uri.fsPath);
		const tasksSources = tasks.map((t) => expandPath(t.source));
		if (!tasksSources.includes(documentPath)) {
			return null;
		}

		const tomParser = getCachedTomlParser(document);
		if (!tomParser) {
			return null;
		}

		const keyAtPosition = tomParser.getKeyAtPosition(position);
		const keyPath = keyAtPosition?.key ?? [];
		if (!keyPath.length) {
			return null;
		}

		// `depends` under [tools.*] refers to other tools, not tasks
		if (keyPath[0] === "tools") {
			return null;
		}

		if (keyPath[0] === "tasks" && keyPath.at(-1) === "extends") {
			return this.provideTaskTemplateDefinition(document, position);
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
				return [];
			}

			// the parsed key handles quoted names like `[tasks."docs:build"]`
			const localName = String(keyPath.at(-1));
			const task = resolveTaskReference(tasks, localName, documentPath);
			if (!task) {
				return [];
			}

			// if on the task definition itself, return itself so that vscode triggers the reference picker
			return [
				{
					targetSelectionRange: new vscode.Range(position, position),
					targetUri: document.uri,
					originSelectionRange: taskNameRange,
					targetRange: new vscode.Range(position, position),
				},
			];
		}

		if (!isDependsKeyword(keyPath.at(-1) || "")) {
			return null;
		}

		const patternRange = document.getWordRangeAtPosition(
			position,
			TASK_PATTERN_REGEX,
		);
		if (!patternRange) {
			return [];
		}

		const pattern = document.getText(patternRange);
		// `^task` refers to upstream projects, which requires the projects graph
		const projects = pattern.startsWith("^")
			? await this.miseService.getTasksGraph()
			: [];
		const matchingTasks = findTasksMatchingDependsPattern(
			tasks,
			pattern,
			documentPath,
			projects,
		);

		return Promise.all(
			matchingTasks.map(async (task) => {
				const uri = vscode.Uri.file(task.source.replace(/^~/, os.homedir()));
				const taskDocument = await vscode.workspace.openTextDocument(uri);

				const foundPosition = findTaskDefinition(taskDocument, task.name);

				return {
					originSelectionRange: patternRange,
					targetUri: vscode.Uri.parse(task.source),
					targetSelectionRange: new vscode.Range(
						foundPosition.start,
						foundPosition.end,
					),
					targetRange: new vscode.Range(
						foundPosition.start,
						foundPosition.end.translate(100, 100), // hack to make the range visible, improve later
					),
				};
			}),
		);
	}

	/**
	 * `extends = "<name>"` refers to a `[task_templates.<name>]` entry, defined
	 * in this config file or one of the parent config files.
	 */
	private async provideTaskTemplateDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.LocationLink[] | null> {
		const templateNameRange = document.getWordRangeAtPosition(
			position,
			TASK_NAME_REGEX,
		);
		if (!templateNameRange) {
			return null;
		}
		const templateName = document.getText(templateNameRange);

		const configPaths = [
			document.uri.fsPath,
			...(await this.miseService.getMiseConfigFiles()).map((f) => f.path),
		];
		const seen = new Set<string>();
		for (const configPath of configPaths) {
			const expanded = expandPath(configPath);
			if (seen.has(expanded)) {
				continue;
			}
			seen.add(expanded);

			let templateDocument: vscode.TextDocument;
			try {
				templateDocument = await vscode.workspace.openTextDocument(
					vscode.Uri.file(configPath.replace(/^~/, os.homedir())),
				);
			} catch {
				continue;
			}

			const found = findTaskTemplatePosition(templateDocument, templateName);
			if (!found) {
				continue;
			}
			return [
				{
					originSelectionRange: templateNameRange,
					targetUri: templateDocument.uri,
					targetRange: new vscode.Range(found.start, found.end),
					targetSelectionRange: new vscode.Range(found.start, found.start),
				},
			];
		}
		return null;
	}
}
