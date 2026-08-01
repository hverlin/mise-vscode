import type * as vscode from "vscode";
import type { MiseTomlType, TomlParser } from "./miseFileParser";

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
