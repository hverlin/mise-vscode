import type * as vscode from "vscode";

function extractTomlKey(token: string): string {
	const t = token.trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t;
}

/**
 * Splits a (possibly dotted) TOML key into its first segment and the rest.
 * Quoted segments may contain dots (e.g. `"http:my.tool".platforms`).
 *
 * - `node` → { first: "node", rest: "" }
 * - `node.version` → { first: "node", rest: ".version" }
 * - `"npm:tool"` → { first: "npm:tool", rest: "" }
 * - `"http:my-tool".platforms` → { first: "http:my-tool", rest: ".platforms" }
 */
function splitFirstKeySegment(raw: string): { first: string; rest: string } {
	const t = raw.trim();
	const quote = t[0];

	if (quote === '"' || quote === "'") {
		const end = t.indexOf(quote, 1);
		if (end !== -1) {
			return { first: t.slice(1, end), rest: t.slice(end + 1).trim() };
		}
	}

	const dotIndex = t.indexOf(".");
	if (dotIndex === -1) {
		return { first: extractTomlKey(t), rest: "" };
	}

	return { first: t.slice(0, dotIndex).trim(), rest: t.slice(dotIndex).trim() };
}

/**
 * Splits a dotted tool key into the tool name and the option path.
 *
 * - `node` → { toolName: "node", optionPath: "" }
 * - `node.version` → { toolName: "node", optionPath: "version" }
 * - `"ubi:sharkdp/fd".version` → { toolName: "ubi:sharkdp/fd", optionPath: "version" }
 */
export function splitDottedToolKey(raw: string): {
	toolName: string;
	optionPath: string;
} {
	const { first, rest } = splitFirstKeySegment(raw);
	return { toolName: first, optionPath: rest.replace(/^\./, "") };
}

/**
 * Parses a `[tools.<name>]` section header line.
 *
 * - `[tools.node]` → { toolName: "node", isSubTable: false }
 * - `[tools."npm:prettier"]` → { toolName: "npm:prettier", isSubTable: false }
 * - `[tools."http:my-tool".platforms]` → { toolName: "http:my-tool", isSubTable: true }
 * - `[tools]`, `[tasks.build]` → undefined
 */
export function parseToolsSectionHeader(
	lineText: string,
): { toolName: string; isSubTable: boolean } | undefined {
	const match = lineText.trim().match(/^\[\s*tools\s*\.\s*(.+?)\s*\]/);
	if (!match?.[1]) {
		return undefined;
	}

	const { first, rest } = splitFirstKeySegment(match[1]);
	if (!first) {
		return undefined;
	}

	return { toolName: first, isSubTable: rest.startsWith(".") };
}

/**
 * Checks if the given position in a TOML document is within a tools definition context.
 * This includes:
 * 1. Inside a `[tools]` block
 * 2. Inside a `[tools.toolName]` section (including its header line)
 * 3. Inside a `tools = { ... }` declaration within a `[tasks.*]` block
 * 4. Inside a `tools.toolName = ...` or `tools."tool:name" = ...` line
 *
 * `inToolOptionsSection` is true for lines inside the body of a `[tools.toolName]`
 * section — those lines hold tool options (`version`, `os`, `postinstall`, ...),
 * not tool declarations. The header line itself is not part of the options body.
 */
export function isPositionInToolsContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): {
	inContext: boolean;
	isInline: boolean;
	inToolOptionsSection: boolean;
	sectionToolName?: string;
} {
	const lineText = document.lineAt(position.line).text;

	// Match `tools = { ... }` inline table
	if (lineText.match(/^\s*tools\s*=\s*\{/)) {
		return { inContext: true, isInline: true, inToolOptionsSection: false };
	}

	// Match `tools.key = ...` or `tools."key" = ...` or `tools.'key' = ...`
	if (lineText.match(/^\s*tools\s*\.\s*(?:["'][^"']+["']|[^\s=]+)\s*=/)) {
		return { inContext: true, isInline: true, inToolOptionsSection: false };
	}

	// Otherwise, fallback to checking if we are under a `[tools]` block or subtable
	for (let i = position.line; i >= 0; i--) {
		const line = document.lineAt(i).text.trim();
		const headerMatch = line.match(/^\[([^\]]+)\]/);
		if (!headerMatch) {
			continue;
		}
		const sectionName = headerMatch[1]?.trim();
		if (sectionName === "tools") {
			return { inContext: true, isInline: false, inToolOptionsSection: false };
		}

		const toolsHeader = parseToolsSectionHeader(line);
		if (toolsHeader) {
			return {
				inContext: true,
				isInline: false,
				// The header line declares the tool; lines below it are options
				inToolOptionsSection: i !== position.line,
				sectionToolName: toolsHeader.toolName,
			};
		}
		break;
	}

	return { inContext: false, isInline: false, inToolOptionsSection: false };
}

/**
 * Checks if the given position in a TOML document is within a task definition
 * context. This includes:
 * 1. Inside a `[tasks]` block
 * 2. Inside a `[tasks.taskName]` section (including its header line)
 * 3. Inside a `tasks.taskName = { ... }` line
 *
 * `[task_templates.*]` sections are not task definitions: templates are
 * resolved for tasks only.
 */
export function isPositionInTasksContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): boolean {
	const lineText = document.lineAt(position.line).text;
	if (/^\s*tasks\s*\.\s*(?:["'][^"']+["']|[^\s=]+)\s*=/.test(lineText)) {
		return true;
	}

	for (let i = position.line; i >= 0; i--) {
		const sectionName = document
			.lineAt(i)
			.text.trim()
			.match(/^\[([^\]]+)\]/)?.[1]
			?.trim();
		if (sectionName === undefined) {
			continue;
		}
		return sectionName === "tasks" || /^tasks\s*\./.test(sectionName);
	}

	return false;
}

/**
 * Parses the text before the cursor when completing the value of an `extends`
 * key, which names a task template:
 *
 * - `extends = "py` → { quote: '"', partial: "py" }
 * - `extends = ` → { quote: "", partial: "" }
 * - `info = { extends = '` → { quote: "'", partial: "" }
 *
 * Returns undefined when the cursor is not on an `extends` value.
 */
export function parseExtendsValuePrefix(
	linePrefix: string,
): { quote: string; partial: string } | undefined {
	const match = linePrefix.match(/(?:^|[\s{,])extends\s*=\s*(["']?)([^"']*)$/);
	if (!match) {
		return undefined;
	}
	return { quote: match[1] ?? "", partial: match[2] ?? "" };
}

const CONFIG_ROOTS_ASSIGNMENT = /^\s*(monorepo\s*\.\s*)?config_roots\s*=\s*\[/;

/**
 * Checks if the given position is inside the value of a
 * `[monorepo] config_roots = [...]` array (or a top-level
 * `monorepo.config_roots = [...]` dotted assignment), including multiline
 * arrays.
 *
 * When in context, `inQuote` tells whether the cursor is inside an open
 * string literal and `partial` holds the path typed so far — the content of
 * the open string, or the bare (not yet quoted) token before the cursor.
 */
export function getConfigRootsArrayContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): { inQuote: boolean; partial: string } | undefined {
	let openLine = -1;
	let openChar = 0;
	let hasMonorepoPrefix = false;

	for (let i = position.line; i >= 0; i--) {
		const lineText =
			i === position.line
				? document.lineAt(i).text.slice(0, position.character)
				: document.lineAt(i).text;

		const match = lineText.match(CONFIG_ROOTS_ASSIGNMENT);
		if (match) {
			openLine = i;
			openChar = match[0].length;
			hasMonorepoPrefix = Boolean(match[1]);
			break;
		}

		const trimmed = lineText.trim();
		// a section header or another assignment means the cursor is not
		// inside a config_roots array value
		if (/^\[/.test(trimmed) || /^[\w."'-]+\s*=/.test(trimmed)) {
			return undefined;
		}
	}
	if (openLine === -1) {
		return undefined;
	}

	if (!hasMonorepoPrefix && !isInMonorepoSection(document, openLine - 1)) {
		return undefined;
	}

	// text from just after the opening `[` to the cursor
	const parts: string[] = [];
	for (let i = openLine; i <= position.line; i++) {
		let text = document.lineAt(i).text;
		if (i === position.line) {
			text = text.slice(0, position.character);
		}
		parts.push(i === openLine ? text.slice(openChar) : text);
	}
	const region = parts.join("\n");

	let depth = 1;
	let stringQuote: string | undefined;
	let stringStart = 0;
	let bareStart = 0;
	for (let idx = 0; idx < region.length; idx++) {
		const ch = region[idx] ?? "";
		if (stringQuote) {
			if (ch === stringQuote || ch === "\n") {
				stringQuote = undefined;
				bareStart = idx + 1;
			}
		} else if (ch === '"' || ch === "'") {
			stringQuote = ch;
			stringStart = idx + 1;
		} else if (ch === "[") {
			depth++;
		} else if (ch === "]") {
			depth--;
			if (depth === 0) {
				return undefined;
			}
		} else if (ch === "#") {
			while (idx < region.length && region[idx] !== "\n") {
				idx++;
			}
			bareStart = idx + 1;
		} else if (/[\s,]/.test(ch)) {
			bareStart = idx + 1;
		}
	}

	return stringQuote
		? { inQuote: true, partial: region.slice(stringStart) }
		: { inQuote: false, partial: region.slice(bareStart) };
}

function isInMonorepoSection(
	document: vscode.TextDocument,
	fromLine: number,
): boolean {
	for (let i = fromLine; i >= 0; i--) {
		const headerMatch = document
			.lineAt(i)
			.text.trim()
			.match(/^\[([^\]]+)\]/);
		if (headerMatch) {
			return headerMatch[1]?.trim() === "monorepo";
		}
	}
	return false;
}

/**
 * Parses the text before the cursor when completing the `version` value inside
 * an inline options table:
 *
 * - `node = { version = "2` → { toolName: "node", quote: '"', partial: "2" }
 * - `node = { version = ` → { toolName: "node", quote: "", partial: "" }
 * - `python = { version = ["3.` → { toolName: "python", quote: '"', partial: "3." }
 *
 * Returns undefined when the cursor is not on a version value (e.g. typing an
 * `os` or `postinstall` option).
 */
export function parseInlineTableVersionPrefix(
	linePrefix: string,
): { toolName: string; quote: string; partial: string } | undefined {
	const match = linePrefix.match(
		/^\s*((?:["'][^"']+["'])|(?:[^\s={]+))\s*=\s*\{.*\bversion\s*=\s*\[?\s*(["']?)([^"'{}[\]]*)$/,
	);
	if (!match?.[1]) {
		return undefined;
	}
	return {
		toolName: splitDottedToolKey(match[1]).toolName,
		quote: match[2] ?? "",
		partial: match[3] ?? "",
	};
}
