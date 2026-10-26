import os from "node:os";
import vscode, { type Definition } from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import {
	findTaskDefinition,
	getCachedTomlParser,
} from "../utils/miseFileParser";
import { isDependsKeyword } from "../utils/miseUtilts";
import {
	findTasksMatchingDependsPattern,
	resolveTaskReference,
	TASK_NAME_REGEX,
	TASK_PATTERN_REGEX,
} from "../utils/taskNames";
import {
	collectFileTaskTemplates,
	collectTaskTemplates,
	formatTaskTemplateMarkdown,
	isMiseConfigFile,
	isTaskExtendsKeyPath,
	isTaskTemplateKeyPath,
	type TaskTemplate,
} from "../utils/taskTemplates";
import {
	getTaskNameValueContext,
	isDaemonsKeyPath,
	isTaskOfDaemonKeyPath,
} from "../utils/tomlParsing";
import { parseFileTaskExtends } from "../utils/usageSpec";

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

		const tomParser = getCachedTomlParser(document);
		if (!tomParser) {
			return null;
		}

		const keyAtPosition = tomParser.getKeyAtPosition(position);
		const keyPath = keyAtPosition?.key ?? [];
		if (!keyPath.length) {
			return null;
		}

		// a config file may declare task templates without declaring any task
		const isTemplateKey =
			isTaskExtendsKeyPath(keyPath) || isTaskTemplateKeyPath(keyPath);
		if (
			!tasksSources.includes(documentPath) &&
			!(
				isTemplateKey &&
				(await isMiseConfigFile(this.miseService, documentPath))
			)
		) {
			return null;
		}

		// `depends` under [tools.*] refers to other tools, not tasks, and under
		// [daemons.*] to other daemons (see daemonNameProviders): a daemon only
		// names a task in its `task`
		if (
			keyPath[0] === "tools" ||
			(isDaemonsKeyPath(keyPath) && !isTaskOfDaemonKeyPath(keyPath))
		) {
			return null;
		}

		if (isTaskExtendsKeyPath(keyPath)) {
			return this.provideTaskTemplateDefinition(document, position);
		}

		// on the declaration itself, return it so that vscode opens the reference
		// picker, which lists the tasks extending the template
		if (isTaskTemplateKeyPath(keyPath)) {
			const templateNameRange = document.getWordRangeAtPosition(
				position,
				TASK_NAME_REGEX,
			);
			return templateNameRange
				? [
						{
							originSelectionRange: templateNameRange,
							targetUri: document.uri,
							targetRange: new vscode.Range(position, position),
							targetSelectionRange: new vscode.Range(position, position),
						},
					]
				: [];
		}

		if (
			(keyPath.length === 1 &&
				!(await isMiseConfigFile(this.miseService, documentPath))) ||
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

		// `run` entries reference tasks in their table form, e.g.
		// `run = [{ task = "build" }, { tasks = ["a", "b"] }]`
		if (
			!isDependsKeyword(keyPath.at(-1) || "") &&
			!getTaskNameValueContext(document, position)
		) {
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
	 * `extends = "<name>"` refers to a `[task_templates.<name>]` entry, declared
	 * in this config file or in one of the parent config files.
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

		const configPaths = (await this.miseService.getMiseConfigFiles()).map(
			(file) => file.path,
		);
		const template = (await collectTaskTemplates(document, configPaths)).find(
			(candidate) => candidate.name === templateName,
		);
		if (!template) {
			return null;
		}

		return [
			{
				originSelectionRange: templateNameRange,
				targetUri: vscode.Uri.file(template.source),
				targetRange: template.headerRange,
				targetSelectionRange: template.nameRange,
			},
		];
	}
}

/**
 * Go to definition and hover for the template of a `#MISE extends="<name>"`
 * header of a file task
 */
export class FileTaskTemplateProvider
	implements vscode.DefinitionProvider, vscode.HoverProvider
{
	constructor(private miseService: MiseService) {}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.LocationLink[] | null> {
		const resolved = await this.resolve(document, position);
		if (!resolved) {
			return null;
		}
		const { range, template } = resolved;
		return [
			{
				originSelectionRange: range,
				targetUri: vscode.Uri.file(template.source),
				targetRange: template.headerRange,
				targetSelectionRange: template.nameRange,
			},
		];
	}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Hover | null> {
		const resolved = await this.resolve(document, position);
		if (!resolved) {
			return null;
		}
		const { range, template } = resolved;
		const markdown = formatTaskTemplateMarkdown(template);
		markdown.appendMarkdown(
			`\n\nDeclared in [${vscode.workspace.asRelativePath(template.source)}](${vscode.Uri.file(template.source)}#L${template.nameRange.start.line + 1})`,
		);
		return new vscode.Hover(markdown, range);
	}

	/** The template name at the position, and the template it resolves to */
	private async resolve(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<{ range: vscode.Range; template: TaskTemplate } | null> {
		if (!isMiseExtensionEnabled()) {
			return null;
		}

		const line = document.lineAt(position).text;
		const templateName = parseFileTaskExtends(line);
		if (!templateName) {
			return null;
		}
		const start = line.indexOf(templateName, line.indexOf("=") + 1);
		const end = start + templateName.length;
		if (position.character < start || position.character > end) {
			return null;
		}

		const template = (
			await collectFileTaskTemplates(this.miseService, document)
		).find((candidate) => candidate.name === templateName);
		return template
			? {
					range: new vscode.Range(position.line, start, position.line, end),
					template,
				}
			: null;
	}
}
