import type { Position, TextDocument } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import {
	findTaskDefinition,
	getCachedTomlParser,
} from "../utils/miseFileParser";
import {
	isTaskDependency,
	resolveTaskReference,
	TASK_NAME_REGEX,
} from "../utils/taskNames";
import {
	collectTaskTemplates,
	collectTaskTemplateUsages,
	isTaskExtendsKeyPath,
	isTaskTemplateKeyPath,
} from "../utils/taskTemplates";

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
		context: vscode.ReferenceContext,
	): Promise<vscode.Location[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		const templateReferences = await this.provideTaskTemplateReferences(
			document,
			position,
			context,
		);
		if (templateReferences) {
			return templateReferences;
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

	/**
	 * The tasks extending a task template, from its `[task_templates.<name>]`
	 * declaration or from any of its `extends = "<name>"` references. Returns
	 * undefined when the position is not on a template name, so that the caller
	 * falls back to task references.
	 */
	private async provideTaskTemplateReferences(
		document: TextDocument,
		position: Position,
		context: vscode.ReferenceContext,
	): Promise<vscode.Location[] | undefined> {
		const keyPath =
			getCachedTomlParser(document)?.getKeyAtPosition(position)?.key;
		if (!keyPath) {
			return undefined;
		}

		let templateName: string | undefined;
		if (isTaskTemplateKeyPath(keyPath)) {
			templateName = String(keyPath[1]);
		} else if (isTaskExtendsKeyPath(keyPath)) {
			const nameRange = document.getWordRangeAtPosition(
				position,
				TASK_NAME_REGEX,
			);
			templateName = nameRange ? document.getText(nameRange) : undefined;
		}
		if (!templateName) {
			return undefined;
		}

		const [taskSources, configFiles] = await Promise.all([
			this.miseService.getAllCachedTasksSources(),
			this.miseService.getMiseConfigFiles(),
		]);
		const configPaths = configFiles.map((file) => file.path);

		const usages = await collectTaskTemplateUsages(
			[document.uri.fsPath, ...taskSources, ...configPaths],
			templateName,
		);
		const locations = usages.map(
			(usage) =>
				new vscode.Location(vscode.Uri.file(usage.source), usage.nameRange),
		);

		if (context.includeDeclaration) {
			const template = (await collectTaskTemplates(document, configPaths)).find(
				(candidate) => candidate.name === templateName,
			);
			if (template) {
				locations.unshift(
					new vscode.Location(
						vscode.Uri.file(template.source),
						template.nameRange,
					),
				);
			}
		}

		return locations;
	}
}
