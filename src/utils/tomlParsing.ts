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
 * Checks if the given position in a TOML document is within a tools definition context.
 * This includes:
 * 1. Inside a `[tools]` block
 * 2. Inside a `tools = { ... }` declaration within a `[tasks.*]` block
 * 3. Inside a `tools.toolName = ...` or `tools."tool:name" = ...` line
 */
export function isPositionInToolsContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): { inContext: boolean; isInline: boolean } {
	const lineText = document.lineAt(position.line).text;

	// Match `tools = { ... }` inline table
	if (lineText.match(/^\s*tools\s*=\s*\{/)) {
		return { inContext: true, isInline: true };
	}

	// Match `tools.key = ...` or `tools."key" = ...` or `tools.'key' = ...`
	if (lineText.match(/^\s*tools\s*\.\s*(?:["'][^"']+["']|[^\s=]+)\s*=/)) {
		return { inContext: true, isInline: true };
	}

	// Otherwise, fallback to checking if we are under a `[tools]` block or subtable
	let inToolsSection = false;
	for (let i = position.line; i >= 0; i--) {
		const line = document.lineAt(i).text.trim();
		const headerMatch = line.match(/^\[([^\]]+)\]/);
		if (headerMatch) {
			const sectionName = headerMatch[1]?.trim();
			if (
				sectionName &&
				(sectionName === "tools" || sectionName.startsWith("tools."))
			) {
				inToolsSection = true;
				break;
			}
			break;
		}
	}

	return { inContext: inToolsSection, isInline: false };
}

export function extractToolNamesFromLine(
	lineText: string,
	word?: string,
): string[] {
	const trimmed = lineText.trim();
	const results: string[] = [];

	// Try parsing as inline definition `tools = { bun = 'latest', node = '20' }`
	if (trimmed.match(/^\s*tools\s*=\s*\{/)) {
		const insideBracesMatch = trimmed.match(/\{(.*)\}/);
		if (insideBracesMatch?.[1]) {
			const parts = insideBracesMatch[1].split(",");
			for (const part of parts) {
				const eqIdx = part.indexOf("=");
				if (eqIdx === -1) continue;
				const keyToken = part.slice(0, eqIdx);
				const cleanKey = extractTomlKey(keyToken);
				if (!word || cleanKey.includes(word)) {
					results.push(cleanKey);
				}
			}
		}
		return results;
	}

	// Try parsing as `tools.toolName = "version"` or `tools."tool:name" = "version"`
	// Key after the dot can be bare or quoted (single/double).
	const dotMatch = trimmed.match(
		/^\s*tools\s*\.\s*((?:["'][^"']+["'])|(?:[^\s=]+))\s*=/,
	);
	if (dotMatch?.[1]) {
		const rawKey = extractTomlKey(dotMatch[1]);
		if (word && !rawKey.includes(word)) {
			return [];
		}
		results.push(rawKey);
		return results;
	}

	// Try parsing as normal block definition `toolName = "version"` or `"tool:name" = ...`
	// Key can be bare (no spaces) or fully quoted.
	const blockMatch = trimmed.match(/^((?:["'][^"']*["'])|(?:[^\s=]+))\s*=/);
	if (blockMatch?.[1]) {
		const rawKey = extractTomlKey(blockMatch[1]);
		if (word && !rawKey.includes(word)) {
			return [];
		}
		results.push(rawKey);
	}

	return results;
}

export function extractToolVersionFromLine(
	lineText: string,
	toolName: string,
): string | undefined {
	const trimmed = lineText.trim();
	const escapedToolName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	const patterns = [
		new RegExp(
			`(?:tools\\.)?['"]?${escapedToolName}['"]?\\s*=\\s*['"]([^'"]+)['"]`,
		),
		new RegExp(
			`['"]?${escapedToolName}['"]?\\s*=\\s*\\{.*version\\s*=\\s*['"]([^'"]+)['"]`,
		),
	];

	for (const regex of patterns) {
		const match = trimmed.match(regex);
		if (match?.[1]) {
			return match[1];
		}
	}
	return undefined;
}
