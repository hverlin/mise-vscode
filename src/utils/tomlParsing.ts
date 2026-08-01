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
