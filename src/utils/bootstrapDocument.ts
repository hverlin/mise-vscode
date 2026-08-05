// Locating `[bootstrap.*]` declarations inside a mise config document, shared
// by the bootstrap tree view (go to declaration) and the code lens (anchoring
// a section summary, and keeping it to the entries of that document)

import * as vscode from "vscode";
import type { BootstrapDefinition, BootstrapEntry } from "./bootstrapUtils";
import { collapseHomePath } from "./fileUtils";
import { getCachedTomlParser } from "./miseFileParser";

/**
 * Range of `key` inside the table at `tablePath`, or undefined when the
 * document does not declare it. An empty `tablePath` looks at the document
 * root, so `[dotfiles]` is found as the `dotfiles` key of the root table.
 */
export function findKeyInTomlDocument(
	document: vscode.TextDocument,
	tablePath: string[],
	key: string,
): vscode.Range | undefined {
	const parser = getCachedTomlParser(document);
	if (!parser) {
		return undefined;
	}

	let table: unknown = parser.parsed;
	for (const part of tablePath) {
		if (!table || typeof table !== "object") {
			return undefined;
		}
		table = (table as Record<string, unknown>)[part];
	}
	if (!table || typeof table !== "object") {
		return undefined;
	}

	return parser.findRange(table as object, key);
}

/**
 * `mise bootstrap status` reports resource paths expanded, but they are usually
 * declared with `~` (e.g. `[bootstrap.files."~/.config/app.conf"]`), so every
 * path-shaped key also gets looked up in its `~` form.
 */
export function withHomePathVariants(
	definitions: BootstrapDefinition[],
): BootstrapDefinition[] {
	return definitions.flatMap((definition) => {
		const collapsed = collapseHomePath(definition.key);
		return collapsed
			? [definition, { ...definition, key: collapsed }]
			: [definition];
	});
}

/** Every way an entry can be keyed in a config file, in lookup order */
export function bootstrapEntryKeyCandidates(
	entry: BootstrapEntry,
): BootstrapDefinition[] {
	return withHomePathVariants([entry.definition, ...(entry.alternates ?? [])]);
}

/**
 * The table this document declares the entry in, or undefined when it does not
 * declare it at all. `bootstrap status` is machine wide and merges every config
 * file, so this is what keeps a lens to the entries of its own document.
 *
 * Resolution follows the alternates, because the table an entry is written in
 * is not always the one it is reported under: `[bootstrap.macos.finder]
 * show_pathbar` is reported as the `com.apple.finder ShowPathbar` default.
 */
export function findBootstrapDeclaration(
	document: vscode.TextDocument,
	entry: BootstrapEntry,
): BootstrapDefinition | undefined {
	return bootstrapEntryKeyCandidates(entry).find((candidate) =>
		findKeyInTomlDocument(document, candidate.tablePath, candidate.key),
	);
}

export type BootstrapDocumentSection = {
	/** table the entries are written in, e.g. ["bootstrap", "macos", "finder"] */
	tablePath: string[];
	/** range of the table header, where the lens is anchored */
	range: vscode.Range;
	entries: BootstrapEntry[];
};

/**
 * Group the entries this document declares by the table they are written in,
 * keeping the order mise reported them in. Entries declared elsewhere, and
 * tables whose header cannot be located, are left out.
 */
export function groupBootstrapEntriesByDeclaringTable(
	document: vscode.TextDocument,
	entries: BootstrapEntry[],
): BootstrapDocumentSection[] {
	const sections = new Map<string, BootstrapDocumentSection>();

	for (const entry of entries) {
		const declaration = findBootstrapDeclaration(document, entry);
		if (!declaration) {
			continue;
		}

		const key = declaration.tablePath.join(" ");
		const existing = sections.get(key);
		if (existing) {
			existing.entries.push(entry);
			continue;
		}

		const range = findBootstrapTableRange(document, declaration.tablePath);
		if (!range) {
			continue;
		}
		sections.set(key, {
			tablePath: declaration.tablePath,
			range,
			entries: [entry],
		});
	}

	return [...sections.values()];
}

/** `[table]`, `[table.sub]` or `[[array]]`, with an optional trailing comment */
const TABLE_HEADER = /^\s*\[\[?[^[\]]+\]\]?\s*(#.*)?$/;

/**
 * The `[table]` header the position belongs to, so a lens renders above the
 * header rather than in the middle of the table. A key is not always written on
 * its header line: `[bootstrap.macos]` + `dock.autohide = true` resolves the
 * `dock` table to the dotted key, one or more lines below its header.
 */
function enclosingTableHeader(
	document: vscode.TextDocument,
	line: number,
): vscode.Range | undefined {
	// while the document is mid-edit the parser serves its last good parse, so
	// the line can point past the end of the text as it is now. Clamping keeps
	// the lens roughly in place instead of throwing, which would drop every lens
	// in the document and make the editor jump
	for (
		let current = Math.min(line, document.lineCount - 1);
		current >= 0;
		current--
	) {
		const text = document.lineAt(current).text;
		if (TABLE_HEADER.test(text)) {
			const indent = text.length - text.trimStart().length;
			return new vscode.Range(
				new vscode.Position(current, indent),
				new vscode.Position(current, text.trimEnd().length),
			);
		}
	}
	return undefined;
}

/**
 * Range to anchor the lens of a section on. `["bootstrap", "packages"]`
 * resolves to the `packages` key of the `bootstrap` table, which is written in
 * the `[bootstrap.packages]` header; the lens is placed on that header.
 */
export function findBootstrapTableRange(
	document: vscode.TextDocument,
	tablePath: string[],
): vscode.Range | undefined {
	const key = tablePath[tablePath.length - 1];
	if (key === undefined) {
		return undefined;
	}
	const range = findKeyInTomlDocument(document, tablePath.slice(0, -1), key);
	if (!range) {
		return undefined;
	}
	return enclosingTableHeader(document, range.start.line) ?? range;
}
