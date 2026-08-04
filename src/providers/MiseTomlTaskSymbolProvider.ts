import * as vscode from "vscode";
import {
	getCachedTomlParser,
	type MiseTomlType,
	type TomlParser,
} from "../utils/miseFileParser";
import { TASK_TEMPLATES_SECTION } from "../utils/taskTemplates";

type VscodeLike = Pick<
	typeof vscode,
	"SymbolKind" | "DocumentSymbol" | "Range" | "Position"
>;
export class MiseTomlTaskSymbolProvider
	implements vscode.DocumentSymbolProvider
{
	private readonly TRIVIAL_TASK_SYMBOL_KIND;
	private readonly TASK_SECTION_SYMBOL_KIND;
	private readonly SECTION_SYMBOL_KIND;
	private symbols: vscode.DocumentSymbol[] = [];

	constructor(private readonly vscode: VscodeLike) {
		this.vscode = vscode;
		this.TRIVIAL_TASK_SYMBOL_KIND = vscode.SymbolKind.Property;
		this.TASK_SECTION_SYMBOL_KIND = vscode.SymbolKind.Function;
		this.SECTION_SYMBOL_KIND = vscode.SymbolKind.Namespace;
	}

	private createSymbol(
		name: string,
		detail: string,
		kind: vscode.SymbolKind,
		range: vscode.Range,
	): vscode.DocumentSymbol {
		const unquotedName = name.replace(/^"(.*)"$/, "$1");
		return new this.vscode.DocumentSymbol(
			unquotedName,
			detail,
			kind,
			range,
			range,
		);
	}

	private getKeyData(
		entries: Record<string, string | object>,
		sourceTracker: TomlParser<MiseTomlType>["sourceTracker"],
		lines: string[],
		key: string,
	): {
		name: string;
		detail: string;
		range: vscode.Range;
	} {
		const { start, file } = sourceTracker.getKeySource(entries, key);
		const lineNumber = file.lineNumberAt(start) - 1; // lineNumberAt is 1-based, we need 0-based
		const line = lines[lineNumber];
		const ret = {
			name: key,
			detail: typeof entries[key] === "string" ? entries[key] : "",
			range: new this.vscode.Range(
				new this.vscode.Position(0, 0),
				new this.vscode.Position(0, 0),
			),
		};
		if (!line) {
			return ret;
		}
		const range = this.createRange(lineNumber, line);
		return {
			...ret,
			range,
		};
	}

	private createRange(index: number, line: string): vscode.Range {
		const startLine = index;
		const endLine = index;
		const startCharacter = 0;
		const endCharacter = line.length;

		return new vscode.Range(
			new this.vscode.Position(startLine, startCharacter),
			new this.vscode.Position(endLine, endCharacter),
		);
	}

	provideDocumentSymbols(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.DocumentSymbol[]> {
		if (token.isCancellationRequested) {
			return this.symbols;
		}
		const symbols: vscode.DocumentSymbol[] = [];

		const parser = getCachedTomlParser(document);
		if (!parser) {
			return this.symbols;
		}
		const { parsed, sourceTracker } = parser;
		const lines = document.getText().split(/\r?\n/);

		for (const mainKey in parsed) {
			const sectionValue =
				parsed[mainKey as keyof MiseTomlType] ??
				(parsed as Record<string, unknown>)[mainKey];

			const { name, detail, range } = this.getKeyData(
				parsed,
				sourceTracker,
				lines,
				mainKey,
			);

			const sectionSymbol = this.createSymbol(
				`[${name}]`,
				detail,
				this.SECTION_SYMBOL_KIND,
				range,
			);

			if (
				sectionValue &&
				typeof sectionValue === "object" &&
				!Array.isArray(sectionValue)
			) {
				const entries = sectionValue as Record<string, string | object>;
				for (const key in entries) {
					const value = entries[key];
					const keyData = this.getKeyData(entries, sourceTracker, lines, key);

					// task templates are declared like tasks and show up the same way
					const isTask =
						mainKey === "tasks" || mainKey === TASK_TEMPLATES_SECTION;
					const isComplexEntry = typeof value === "object" && value !== null;

					sectionSymbol.children.push(
						this.createSymbol(
							keyData.name,
							typeof value === "string" ? keyData.detail : "",
							isTask && isComplexEntry
								? this.TASK_SECTION_SYMBOL_KIND
								: this.TRIVIAL_TASK_SYMBOL_KIND,
							keyData.range,
						),
					);
				}
			}

			symbols.push(sectionSymbol);
		}
		this.symbols = symbols;
		return symbols;
	}
}
