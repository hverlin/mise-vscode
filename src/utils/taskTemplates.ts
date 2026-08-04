/**
 * Task templates (https://mise.jdx.dev/tasks/templates.html): reusable
 * `[task_templates.<name>]` entries that tasks pick up with `extends = "<name>"`.
 * A task resolves a template from its own config file or from a parent config,
 * which is what makes them useful in monorepos
 * (https://mise.jdx.dev/tasks/monorepo.html#task-templates).
 */

import * as vscode from "vscode";
import { expandPath } from "./fileUtils";
import { getCachedTomlParser } from "./miseFileParser";

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
	/** the whole entry, so that peeking the definition shows its body */
	bodyRange: vscode.Range;
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
 * A `[task_templates.<name>]` section spans until the next table header. The
 * parser only reports the header line, which would make peeking a definition
 * show a template without its body.
 */
function sectionBodyRange(
	document: vscode.TextDocument,
	headerLine: number,
): vscode.Range {
	let lastLine = headerLine;
	for (let line = headerLine + 1; line < document.lineCount; line++) {
		const text = document.lineAt(line).text;
		if (/^\s*\[/.test(text)) {
			break;
		}
		if (text.trim() !== "") {
			lastLine = line;
		}
	}
	return new vscode.Range(
		new vscode.Position(headerLine, 0),
		document.lineAt(lastLine).range.end,
	);
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
			bodyRange: isSectionHeader
				? sectionBodyRange(document, entry.keyStart.line)
				: new vscode.Range(
						toPosition(entry.keyStart),
						toPosition(entry.valueEnd),
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
	getMiseConfigFiles(): Promise<Array<{ path: string }>>;
};

/**
 * Whether mise loads the document as one of its config files. Task templates
 * can be declared in a config file that defines no task at all, which the
 * "is this a task source" check of the task features would turn down.
 */
export async function isMiseConfigFile(
	miseService: ConfigFileLister,
	documentPath: string,
): Promise<boolean> {
	const expanded = expandPath(documentPath);
	return (await miseService.getMiseConfigFiles()).some(
		(file) => expandPath(file.path) === expanded,
	);
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

function formatTomlValue(value: unknown): string {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(formatTomlValue).join(", ")}]`;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).map(
			([key, entryValue]) => `${key} = ${formatTomlValue(entryValue)}`,
		);
		return `{ ${entries.join(", ")} }`;
	}
	return String(value);
}

/**
 * The template as it is declared, for hovers and completion documentation:
 * the description as text, `run` as a shell block, the rest as TOML.
 */
export function formatTaskTemplateMarkdown(
	template: TaskTemplate,
	{ header = true }: { header?: boolean } = {},
): vscode.MarkdownString {
	const markdown = new vscode.MarkdownString();
	markdown.supportHtml = true;

	if (header) {
		markdown.appendMarkdown(`**${template.name}** (task template)`);
	}

	const { description, run, ...rest } = template.fields;
	if (typeof description === "string" && description) {
		markdown.appendMarkdown(`${header ? "<br />" : ""}${description}`);
	}

	if (typeof run === "string") {
		markdown.appendCodeblock(run, "shell");
	} else if (Array.isArray(run)) {
		markdown.appendCodeblock(run.map(String).join("\n"), "shell");
	}

	const remaining = Object.entries(rest);
	if (remaining.length) {
		markdown.appendCodeblock(
			remaining
				.map(([key, value]) => `${key} = ${formatTomlValue(value)}`)
				.join("\n"),
			"toml",
		);
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
