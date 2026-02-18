import * as vscode from "vscode";

type VscodeLike = Pick<
  typeof vscode,
  "SymbolKind" | "DocumentSymbol" | "Range" | "Position"
>;

export class MiseTomlTaskSymbolProvider
  implements vscode.DocumentSymbolProvider
{
  private readonly TRIVIAL_TASK_SYMBOL_KIND;
  private readonly TASK_SECTION_SYMBOL_KIND;

  constructor(private readonly vscode: VscodeLike) {
    this.vscode = vscode;
    this.TRIVIAL_TASK_SYMBOL_KIND = vscode.SymbolKind.Property;
    this.TASK_SECTION_SYMBOL_KIND = vscode.SymbolKind.Function;
  }

  private createDocumentSymbol(
    name: string,
    detail: string,
    kind: vscode.SymbolKind,
    range: vscode.Range,
    selectionRange: vscode.Range,
  ): vscode.DocumentSymbol {
    return new this.vscode.DocumentSymbol(
      name,
      detail,
      kind,
      range,
      selectionRange,
    );
  }

  private createRange(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ): vscode.Range {
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
    const text = document.getText();
    const lines = text.split(/\r?\n/);

    const sectionRegex = /^\s*\[\s*tasks(?:\.(.+?))?\s*\]\s*$/;

    const trivialRegex =
      /^\s*(?:"(.+)"\s*=|(?:([A-Za-z0-9_-]+)\s*=))\s*(.+)\s*$/;

    let checkingTasksSection = false;
    lines.forEach((line, index) => {
      const lineRange = this.createRange(index, 0, index, line.length);
      const sectionMatch = line.match(sectionRegex);
      if (sectionMatch) {
        const rawName = sectionMatch[1];
        const sectionName = rawName || "tasks";

        // it is just the "tasks" section, we set checkingTasksSection to true,
        // so we can check for trivial key-value pairs in the following lines,
        // until we find another section
        if (rawName === undefined) {
          checkingTasksSection = true;
          return;
        }
        if (checkingTasksSection && rawName !== undefined) {
          // we found a subsection of "tasks", we can stop checking for trivial key-value pairs
          checkingTasksSection = false;
        }

        const unquotedSectionName = sectionName.replace(/^"(.*)"$/, "$1");

        const sectionSymbol = this.createDocumentSymbol(
          unquotedSectionName,
          "",
          this.TASK_SECTION_SYMBOL_KIND,
          lineRange,
          lineRange,
        );
        symbols.push(sectionSymbol);
        return;
      }
      if (!checkingTasksSection) {
        return;
      }
      const trivialMatch = line.match(trivialRegex);
      if (trivialMatch) {
        const key = trivialMatch[1] || trivialMatch[2];
        const value = trivialMatch[3];
        if (key === undefined || value === undefined) {
          return;
        }
        const trivialSymbol = this.createDocumentSymbol(
          key,
          value,
          this.TRIVIAL_TASK_SYMBOL_KIND,
          lineRange,
          lineRange,
        );
        symbols.push(trivialSymbol);
      }
    });
    return symbols;
  }
}
