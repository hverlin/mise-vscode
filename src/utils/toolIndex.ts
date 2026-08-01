import * as vscode from "vscode";
import {
	getCachedTomlParser,
	type MiseTomlType,
	type TomlParser,
} from "./miseFileParser";
import { isToolVersionsFile } from "./miseUtilts";

export type DeclaredTool = {
	/** decoded tool name (quotes removed, e.g. `github:cli/cli`) */
	toolName: string;
	/** exact range of the key token in the document (includes quotes when quoted) */
	range: vscode.Range;
	/** requested version: string value, inline-table `version`, or first array entry */
	requestedVersion?: string;
	/** declared in a task's `tools` table rather than a top-level tools table */
	inTask: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function requestedVersionFromValue(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return typeof value[0] === "string" ? value[0] : undefined;
	}
	if (isPlainObject(value)) {
		return requestedVersionFromValue(value.version);
	}
	return undefined;
}

/**
 * Lists every tool declared in a parsed mise TOML document, with the exact
 * range of each declaration. All TOML declaration styles resolve to the same
 * parsed shape, so this covers:
 *
 * - `[tools]` entries: `node = "22"`, `"npm:x" = { version = "1" }`,
 *   `python = ["3.10", "3.11"]`, dotted keys like `"ubi:x".version = "1"`
 * - `[tools.node]` sections (options such as `version`/`os`/`postinstall`
 *   are part of the tool's value, not separate declarations; sub-tables like
 *   `[tools.x.platforms]` do not declare new tools)
 * - `tools = { ... }` and `tools.<name> = ...` inside tasks
 */
export function buildToolIndex(
	parser: TomlParser<MiseTomlType>,
): DeclaredTool[] {
	const tools: DeclaredTool[] = [];

	const collect = (toolsTable: Record<string, unknown>, inTask: boolean) => {
		for (const [toolName, value] of Object.entries(toolsTable)) {
			const range = parser.findRange(toolsTable, toolName);
			if (!range) {
				continue;
			}
			tools.push({
				toolName,
				range,
				requestedVersion: requestedVersionFromValue(value),
				inTask,
			});
		}
	};

	const visit = (obj: Record<string, unknown>, path: string[]) => {
		for (const [key, value] of Object.entries(obj)) {
			if (!isPlainObject(value)) {
				continue;
			}
			// `[tasks.tools]` is a task *named* tools, not a tools table
			const isTaskNamedTools =
				key === "tools" && path.length === 1 && path[0] === "tasks";
			if (key === "tools" && !isTaskNamedTools) {
				collect(value, path.length > 0);
			} else if (path.length < 3) {
				// deep enough to reach `tasks.<name>.tools`
				visit(value, [...path, key]);
			}
		}
	};

	visit(parser.parsed as Record<string, unknown>, []);
	return tools;
}

/**
 * Lists tools declared in an asdf-style `.tool-versions` file:
 *
 * ```
 * # comment
 * nodejs 20.11.0        # trailing comment
 * python 3.12.0 3.11.0  # multiple versions, first one wins
 * ```
 */
export function buildToolVersionsIndex(
	document: vscode.TextDocument,
): DeclaredTool[] {
	const tools: DeclaredTool[] = [];
	for (let line = 0; line < document.lineCount; line++) {
		const text = document.lineAt(line).text;
		const withoutComment = (text.split("#")[0] ?? "").trimEnd();
		const match = withoutComment.match(/^(\s*)(\S+)\s*(.*)$/);
		if (!match?.[2]) {
			continue;
		}
		const indent = match[1]?.length ?? 0;
		const toolName = match[2];
		const versions = match[3]?.trim().split(/\s+/).filter(Boolean) ?? [];
		tools.push({
			toolName,
			range: new vscode.Range(
				new vscode.Position(line, indent),
				new vscode.Position(line, indent + toolName.length),
			),
			requestedVersion: versions[0],
			inTask: false,
		});
	}
	return tools;
}

/**
 * A version is "concrete" when it can be compared against a resolved version
 * with a prefix match. `latest`, `lts`, `system`, and scoped specifiers like
 * `ref:<sha>`/`path:<dir>`/`prefix:<v>`/`sub-<n>:<v>` cannot, so version
 * mismatch checks should be skipped for them.
 */
export function isConcreteVersion(version: string): boolean {
	if (
		version === "latest" ||
		version === "system" ||
		version.startsWith("lts")
	) {
		return false;
	}
	return !/^(ref:|path:|prefix:|sub-)/.test(version);
}

/**
 * Returns the tools declared in the given document, whatever its syntax:
 * mise TOML configs go through the cached TOML parser; `.tool-versions`
 * files are parsed line by line.
 */
export function getToolIndexForDocument(
	document: vscode.TextDocument,
): DeclaredTool[] {
	if (isToolVersionsFile(document.fileName)) {
		return buildToolVersionsIndex(document);
	}
	const parser = getCachedTomlParser(document);
	return parser ? buildToolIndex(parser) : [];
}
