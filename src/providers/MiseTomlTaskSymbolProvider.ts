import * as vscode from "vscode";
import { MiseTomlType, TomlParser } from "../utils/miseFileParser";

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
    return new this.vscode.DocumentSymbol(name, detail, kind, range, range);
  }

  private getKeyData(
    entries: Record<string, any>,
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
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];

    const { parsed, sourceTracker } = new TomlParser<
      MiseTomlType & { [key: string]: Record<string, any> }
    >(document.getText());
    const lines = document.getText().split(/\r?\n/);

    for (const mainKey in parsed) {
      if (["settings", "env", "tools"].includes(mainKey)) {
        const { name, detail, range } = this.getKeyData(
          parsed,
          sourceTracker,
          lines,
          mainKey,
        );
        symbols.push(
          this.createSymbol(
            `[${name}]`,
            detail,
            this.SECTION_SYMBOL_KIND,
            range,
          ),
        );
      }
      if (mainKey === "tasks") {
        for (const key in parsed.tasks) {
          const value = parsed.tasks[key];
          const { name, detail, range } = this.getKeyData(
            parsed.tasks,
            sourceTracker,
            lines,
            key,
          );
          symbols.push(
            this.createSymbol(
              name,
              typeof value === "string" ? detail : "",
              typeof value === "string"
                ? this.TRIVIAL_TASK_SYMBOL_KIND
                : this.TASK_SECTION_SYMBOL_KIND,
              range,
            ),
          );
        }
      }
    }
    return symbols;
  }
}
