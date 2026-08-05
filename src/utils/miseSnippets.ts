import type * as vscode from "vscode";
import fileTaskSnippetDefinitions from "../snippets/file-tasks-snippets.json";
import tomlSnippetDefinitions from "../snippets/toml-tasks-snippets.json";

export type MiseSnippet = {
	prefix: string;
	description: string;
	/** TextMate snippet syntax, as `vscode.SnippetString` takes it */
	body: string;
};

type SnippetDefinitions = Record<
	string,
	{ prefix: string; description: string; body: string[] }
>;

/** The definitions are listed in the order they are suggested in */
const toSnippets = (definitions: SnippetDefinitions): MiseSnippet[] =>
	Object.values(definitions).map(({ prefix, description, body }) => ({
		prefix,
		description,
		body: body.join("\n"),
	}));

/** Snippets for mise config files (`[tasks.name]`, ...) */
export const tomlSnippets = toSnippets(tomlSnippetDefinitions);

/** Snippets for file tasks (`#MISE`/`#USAGE` headers) */
export const fileTaskSnippets = toSnippets(fileTaskSnippetDefinitions);

/** The typed text a snippet replaces, as a column range on the cursor line */
export type SnippetPosition = { replaceStart: number };

/**
 * Where the cursor sits in a mise config file, when a snippet can be inserted
 * there: at the start of an otherwise empty line, outside of strings, comments,
 * arrays and inline tables. Every snippet opens a new table, so anywhere else
 * inserting one would produce a broken file.
 *
 * A `[` already typed is part of what the snippet replaces, so `[tas` completes
 * to `[tasks.name]` rather than `[[tasks.name]`.
 */
export function getTomlSnippetPosition(
	document: vscode.TextDocument,
	position: vscode.Position,
): SnippetPosition | undefined {
	const line = document.lineAt(position.line).text;
	const linePrefix = line.slice(0, position.character);
	if (line.slice(position.character).trim() !== "") {
		return undefined;
	}

	// `-` is part of the word: the snippet prefixes are `mise-task-*`, and it is
	// a legal character in a bare TOML key
	const typed = linePrefix.match(
		/^[ \t]*(\[?[A-Za-z_][A-Za-z0-9_-]*|\[?)$/,
	)?.[1];
	if (typed === undefined) {
		return undefined;
	}

	const replaceStart = linePrefix.length - typed.length;
	if (!isPlainTomlContext(textBefore(document, position.line, replaceStart))) {
		return undefined;
	}

	return { replaceStart };
}

/**
 * Where the cursor sits in a file task, when a `#MISE`/`#USAGE` snippet can be
 * inserted there: at the start of an otherwise empty line in the header comment
 * block, which is where mise reads task configuration from.
 */
export function getFileTaskSnippetPosition(
	document: vscode.TextDocument,
	position: vscode.Position,
): SnippetPosition | undefined {
	const line = document.lineAt(position.line).text;
	const linePrefix = line.slice(0, position.character);
	if (line.slice(position.character).trim() !== "") {
		return undefined;
	}

	const typed = linePrefix.match(/^[ \t]*(#?[A-Za-z][A-Za-z0-9_-]*|#?)$/)?.[1];
	if (typed === undefined) {
		return undefined;
	}

	// only the shebang, comments and blank lines may come before
	for (let lineNumber = position.line - 1; lineNumber >= 0; lineNumber--) {
		const text = document.lineAt(lineNumber).text.trim();
		if (text !== "" && !text.startsWith("#")) {
			return undefined;
		}
	}

	return { replaceStart: linePrefix.length - typed.length };
}

/** Document text from the start up to `character` on `line` */
function textBefore(
	document: vscode.TextDocument,
	line: number,
	character: number,
): string {
	const lines: string[] = [];
	for (let lineNumber = 0; lineNumber <= line; lineNumber++) {
		const text = document.lineAt(lineNumber).text;
		lines.push(lineNumber === line ? text.slice(0, character) : text);
	}
	return lines.join("\n");
}

/**
 * Whether `text` ends outside of any string, comment, array or inline table,
 * i.e. whether what follows it starts a new top-level entry.
 */
function isPlainTomlContext(text: string): boolean {
	let depth = 0;
	let index = 0;

	while (index < text.length) {
		const char = text[index];

		if (char === "#") {
			while (index < text.length && text[index] !== "\n") {
				index++;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			const delimiter = text.startsWith(char.repeat(3), index)
				? char.repeat(3)
				: char;
			const escapable = char === '"';
			index += delimiter.length;

			let closed = false;
			while (index < text.length) {
				if (escapable && text[index] === "\\") {
					index += 2;
					continue;
				}
				if (text.startsWith(delimiter, index)) {
					index += delimiter.length;
					closed = true;
					break;
				}
				// a single line string never runs past the end of its line
				if (delimiter.length === 1 && text[index] === "\n") {
					break;
				}
				index++;
			}
			if (!closed && index >= text.length) {
				return false;
			}
			continue;
		}

		if (char === "[" || char === "{") {
			depth++;
		} else if (char === "]" || char === "}") {
			depth = Math.max(0, depth - 1);
		}
		index++;
	}

	return depth === 0;
}
