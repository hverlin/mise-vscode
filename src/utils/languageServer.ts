import type * as vscode from "vscode";

/**
 * How Tombi and Even Better TOML name their diagnostics. They check mise
 * config files against the mise schema, associated by the JSON Schema Store
 * catalog they use, the schema `mise config explain` and `mise lsp` use too.
 */
export const SCHEMA_DIAGNOSTIC_SOURCE = /tombi|even better toml|taplo/i;

/** The TOML extensions that complete, document and format the keys too */
export const TOML_EXTENSION_IDS = [
	"tombi-toml.tombi",
	"tamasfe.even-better-toml",
];

/**
 * The features `mise lsp` leaves to others (`initializationOptions`). This
 * extension goes to the definitions and references of tasks itself, from the
 * tasks mise resolves (file tasks, other config files, monorepos). The
 * semantic tokens color whole `{{ }}` templates, over the Tera highlighting
 * of the grammar. A TOML extension already completes, documents and formats
 * the keys.
 */
export function getInitializationOptions(hasTomlExtension: boolean) {
	return {
		definition: false,
		references: false,
		semanticTokens: false,
		...(hasTomlExtension
			? { completion: false, hover: false, formatting: false }
			: {}),
	};
}

/** a hover or completion documentation of `mise lsp` for one of these */
const TASK_OR_TOOL_DOCUMENTATION =
	/^\*\*[^*\n]+\*\* _(?:task|task template|tool)_/;

const markdownOf = (
	content: vscode.MarkdownString | vscode.MarkedString | undefined,
) => (typeof content === "string" ? content : (content?.value ?? ""));

/**
 * Whether a hover of `mise lsp` is about a task, a task template or a tool.
 * This extension has its own, from the tasks and tools mise resolves.
 */
export function isTaskOrToolHover(hover: vscode.Hover): boolean {
	return hover.contents.some((content) =>
		TASK_OR_TOOL_DOCUMENTATION.test(markdownOf(content)),
	);
}

/**
 * Whether a completion of `mise lsp` is a task, a task template or a tool
 * name. This extension has its own, from the tasks and tools mise resolves.
 */
export function isTaskOrToolCompletion(item: vscode.CompletionItem): boolean {
	return (
		item.detail === "task" ||
		item.detail === "task template" ||
		TASK_OR_TOOL_DOCUMENTATION.test(markdownOf(item.documentation))
	);
}

/** the problems of tasks `mise tasks validate` reports too */
const TASK_DIAGNOSTIC_CODES = new Set(["unknown-task", "task-cycle"]);

const codeOf = (diagnostic: vscode.Diagnostic) =>
	typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;

const comparePositions = (a: vscode.Position, b: vscode.Position) =>
	a.line - b.line || a.character - b.character;

const isEmpty = (range: vscode.Range) =>
	comparePositions(range.start, range.end) === 0;

/** whether two ranges share a character, or an empty one lies on the other */
function overlaps(a: vscode.Range, b: vscode.Range): boolean {
	const startsBeforeEnd = (x: vscode.Range, y: vscode.Range) => {
		const order = comparePositions(x.start, y.end);
		return order < 0 || (order === 0 && (isEmpty(x) || isEmpty(y)));
	};
	return startsBeforeEnd(a, b) && startsBeforeEnd(b, a);
}

/**
 * The diagnostics of `mise lsp` to show, and those to hide but keep for their
 * quick fixes: the problems Tombi or Even Better TOML already report on the
 * same range, and the problems of tasks while `mise tasks validate` reports
 * them.
 *
 * @param others the diagnostics of the other extensions for the document
 */
export function splitDiagnostics(
	diagnostics: readonly vscode.Diagnostic[],
	others: readonly vscode.Diagnostic[],
	taskDiagnosticsEnabled: boolean,
): { shown: vscode.Diagnostic[]; hidden: vscode.Diagnostic[] } {
	const reported = others.filter((diagnostic) =>
		SCHEMA_DIAGNOSTIC_SOURCE.test(String(diagnostic.source ?? "")),
	);
	const shown: vscode.Diagnostic[] = [];
	const hidden: vscode.Diagnostic[] = [];
	for (const diagnostic of diagnostics) {
		const isHidden =
			(taskDiagnosticsEnabled &&
				TASK_DIAGNOSTIC_CODES.has(String(codeOf(diagnostic)))) ||
			reported.some((other) => overlaps(other.range, diagnostic.range));
		(isHidden ? hidden : shown).push(diagnostic);
	}
	return { shown, hidden };
}

/** whether showing these diagnostics would change nothing */
export function sameDiagnostics(
	a: readonly vscode.Diagnostic[],
	b: readonly vscode.Diagnostic[],
): boolean {
	return (
		a.length === b.length &&
		a.every(
			(diagnostic, index) =>
				diagnostic.message === b[index]?.message &&
				comparePositions(diagnostic.range.start, b[index].range.start) === 0 &&
				comparePositions(diagnostic.range.end, b[index].range.end) === 0,
		)
	);
}

/** whether a diagnostic lies on, or touches, a range */
export const isOn = (diagnostic: vscode.Diagnostic, range: vscode.Range) =>
	overlaps(diagnostic.range, range) ||
	comparePositions(diagnostic.range.end, range.start) === 0 ||
	comparePositions(range.end, diagnostic.range.start) === 0;
