/**
 * Task templates (https://mise.jdx.dev/tasks/templates.html): reusable
 * `[task_templates.<name>]` entries that tasks pick up with `extends = "<name>"`.
 * A task resolves a template from its own config file or from a parent config,
 * which is what makes them useful in monorepos
 * (https://mise.jdx.dev/tasks/monorepo.html#task-templates).
 */

import * as path from "node:path";
import * as vscode from "vscode";
import { expandPath } from "./fileUtils";
import { getCachedTomlParser } from "./miseFileParser";
import { isMiseConfigPath } from "./miseUtilts";

export const TASK_TEMPLATES_SECTION = "task_templates";
export const EXTENDS_KEY = "extends";

/** A `[task_templates.<name>]` entry, located in the config file declaring it */
export type TaskTemplate = {
	name: string;
	/** path of the config file declaring the template */
	source: string;
	/** declared fields, `{ run }` for the `<name> = "<command>"` shorthand */
	fields: Record<string, unknown>;
	/** the declared name, without the quotes of `[task_templates."a:b"]` */
	nameRange: vscode.Range;
	/**
	 * the line declaring the name, which go to definition targets: holding cmd
	 * previews this line, not the body the hover already shows
	 */
	headerRange: vscode.Range;
	/**
	 * the entry as written: the lines below a `[task_templates.<name>]` header,
	 * or the `<name> = ...` of the inline and shorthand forms
	 */
	text: string;
};

/** An `extends = "<name>"` reference of a task to a template */
export type TaskTemplateUsage = {
	templateName: string;
	/** local name of the task extending the template */
	taskName: string;
	/** path of the config file declaring the task */
	source: string;
	/** the template name, without the surrounding quotes */
	nameRange: vscode.Range;
};

type SourcePosition = { line: number; character: number };

/**
 * `extends` of a task. Templates are only resolved for `[tasks.*]` entries, so
 * an `extends` key of any other section is left alone.
 */
export function isTaskExtendsKeyPath(keyPath: readonly string[]): boolean {
	return (
		keyPath.length === 3 && keyPath[0] === "tasks" && keyPath[2] === EXTENDS_KEY
	);
}

/** The `<name>` of a `[task_templates.<name>]` entry */
export function isTaskTemplateKeyPath(keyPath: readonly string[]): boolean {
	return keyPath.length === 2 && keyPath[0] === TASK_TEMPLATES_SECTION;
}

function toPosition(position: SourcePosition): vscode.Position {
	return new vscode.Position(position.line, position.character);
}

/**
 * Parsed key and value ranges cover the TOML syntax around the name (the
 * `."with:colons"` of a section header, the quotes of a string value), so they
 * are narrowed down to the name itself before being reported to the editor.
 */
function narrowToName(
	document: vscode.TextDocument,
	start: SourcePosition,
	end: SourcePosition,
	name: string,
): vscode.Range {
	const range = new vscode.Range(toPosition(start), toPosition(end));
	if (start.line !== end.line) {
		return range;
	}

	const offset = document.getText(range).indexOf(name);
	if (offset === -1) {
		return range;
	}
	return new vscode.Range(
		new vscode.Position(start.line, start.character + offset),
		new vscode.Position(start.line, start.character + offset + name.length),
	);
}

/**
 * The lines below a `[task_templates.<name>]` header, until the next table
 * header. The parser only reports the header line.
 */
function sectionBodyText(
	document: vscode.TextDocument,
	headerLine: number,
): string {
	const lines: string[] = [];
	for (let line = headerLine + 1; line < document.lineCount; line++) {
		const text = document.lineAt(line).text;
		if (/^\s*\[/.test(text)) {
			break;
		}
		lines.push(text);
	}
	return lines.join("\n").trim();
}

/** Templates declared by a single config file */
export function findTaskTemplatesInDocument(
	document: vscode.TextDocument,
): TaskTemplate[] {
	if (!document.fileName.endsWith(".toml")) {
		return [];
	}

	const parser = getCachedTomlParser(document);
	if (!parser?.parsed?.task_templates) {
		return [];
	}

	const templates: TaskTemplate[] = [];
	for (const entry of parser.getAllPositions()) {
		if (!isTaskTemplateKeyPath(entry.key)) {
			continue;
		}

		const name = String(entry.key[1]);
		const isSectionHeader = /^\s*\[/.test(
			document.lineAt(entry.keyStart.line).text,
		);

		templates.push({
			name,
			source: document.uri.fsPath,
			fields: toTemplateFields(entry.value),
			nameRange: narrowToName(document, entry.keyStart, entry.keyEnd, name),
			headerRange: document.lineAt(entry.keyStart.line).range,
			text: isSectionHeader
				? sectionBodyText(document, entry.keyStart.line)
				: document.getText(
						new vscode.Range(
							toPosition(entry.keyStart),
							toPosition(entry.valueEnd),
						),
					),
		});
	}
	return templates;
}

/** `<name> = "<command>"` is the shorthand of a template that only runs a command */
function toTemplateFields(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		return { run: value };
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

/**
 * The `extends = "<name>"` references of a single config file, of every
 * template or of `templateName` only.
 */
export function findTaskTemplateUsagesInDocument(
	document: vscode.TextDocument,
	templateName?: string,
): TaskTemplateUsage[] {
	if (!document.fileName.endsWith(".toml")) {
		return [];
	}

	const parser = getCachedTomlParser(document);
	if (!parser) {
		return [];
	}

	const usages: TaskTemplateUsage[] = [];
	for (const entry of parser.getAllPositions()) {
		if (!isTaskExtendsKeyPath(entry.key) || typeof entry.value !== "string") {
			continue;
		}
		if (templateName !== undefined && entry.value !== templateName) {
			continue;
		}

		usages.push({
			templateName: entry.value,
			taskName: String(entry.key[1]),
			source: document.uri.fsPath,
			nameRange: narrowToName(
				document,
				entry.valueStart,
				entry.valueEnd,
				entry.value,
			),
		});
	}
	return usages;
}

/** Structural type of `MiseService`, which cannot be imported here (cycle) */
type ConfigFileLister = {
	getMiseConfigFiles(options?: {
		configRootPath?: string;
	}): Promise<Array<{ path: string }>>;
};

/**
 * Whether the document is a mise config file, as opposed to a toml file of
 * `task_config.includes` that only declares tasks. Task templates can be
 * declared in a config file that defines no task at all, which the "is this a
 * task source" check of the task features would turn down.
 *
 * The file name decides first: `mise config ls` does not list the config
 * files of monorepo subprojects. mise is only asked about other names, such as
 * a global config set with `MISE_GLOBAL_CONFIG_FILE`.
 */
export async function isMiseConfigFile(
	miseService: ConfigFileLister,
	documentPath: string,
): Promise<boolean> {
	const expanded = expandPath(documentPath);
	if (isMiseConfigPath(expanded)) {
		return true;
	}

	try {
		return (await miseService.getMiseConfigFiles()).some(
			(file) => expandPath(file.path) === expanded,
		);
	} catch {
		// a config that does not parse, with no previous output to serve
		return false;
	}
}

async function openConfigDocument(
	fsPath: string,
): Promise<vscode.TextDocument | undefined> {
	try {
		return await vscode.workspace.openTextDocument(
			vscode.Uri.file(expandPath(fsPath)),
		);
	} catch {
		return undefined;
	}
}

/**
 * Templates a task declared in `document` can extend: the ones of its own
 * config file, then the ones of the parent config files. `configPaths` is
 * expected in mise precedence order (closest config first) so that a name
 * declared twice resolves to the closest declaration, as mise does.
 */
export async function collectTaskTemplates(
	document: vscode.TextDocument,
	configPaths: string[],
): Promise<TaskTemplate[]> {
	const byName = new Map<string, TaskTemplate>();
	const visited = new Set<string>();
	const documentPath = expandPath(document.uri.fsPath);

	for (const configPath of [documentPath, ...configPaths]) {
		const expanded = expandPath(configPath);
		if (visited.has(expanded) || !expanded.endsWith(".toml")) {
			continue;
		}
		visited.add(expanded);

		const configDocument =
			expanded === documentPath ? document : await openConfigDocument(expanded);
		if (!configDocument) {
			continue;
		}

		for (const template of findTaskTemplatesInDocument(configDocument)) {
			if (!byName.has(template.name)) {
				byName.set(template.name, template);
			}
		}
	}

	return [...byName.values()];
}

/**
 * Templates a file task can extend: the ones of the config files above the
 * script, which are not the configs of the workspace root when the task
 * belongs to a monorepo subproject.
 */
export async function collectFileTaskTemplates(
	miseService: ConfigFileLister,
	document: vscode.TextDocument,
): Promise<TaskTemplate[]> {
	const configPaths = (
		await miseService.getMiseConfigFiles({
			configRootPath: path.dirname(document.uri.fsPath),
		})
	).map((file) => file.path);
	return collectTaskTemplates(document, configPaths);
}

/**
 * Every `extends = "<name>"` of the config files of the workspace. Templates
 * are inherited downwards, so the tasks extending one can live in any config
 * file below the one declaring it.
 */
export async function collectTaskTemplateUsages(
	configPaths: string[],
	templateName?: string,
): Promise<TaskTemplateUsage[]> {
	const usages: TaskTemplateUsage[] = [];
	const visited = new Set<string>();

	for (const configPath of configPaths) {
		const expanded = expandPath(configPath);
		if (visited.has(expanded) || !expanded.endsWith(".toml")) {
			continue;
		}
		visited.add(expanded);

		const configDocument = await openConfigDocument(expanded);
		if (!configDocument) {
			continue;
		}
		usages.push(
			...findTaskTemplateUsagesInDocument(configDocument, templateName),
		);
	}

	return usages;
}

/**
 * The template as it is written in its config file, for hovers and
 * completion documentation
 */
export function formatTaskTemplateMarkdown(
	template: TaskTemplate,
	{ header = true }: { header?: boolean } = {},
): vscode.MarkdownString {
	const markdown = new vscode.MarkdownString();
	if (header) {
		markdown.appendMarkdown(`**${template.name}** (task template)`);
	}
	if (template.text) {
		markdown.appendCodeblock(template.text, "toml");
	}
	return markdown;
}

/** Short one-line summary of a template, for completion item details */
export function formatTaskTemplateDetail(template: TaskTemplate): string {
	const { description, run } = template.fields;
	if (typeof description === "string" && description) {
		return description;
	}
	if (typeof run === "string") {
		return run;
	}
	if (Array.isArray(run) && typeof run[0] === "string") {
		return run[0];
	}
	return "task template";
}
