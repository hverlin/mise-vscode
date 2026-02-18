import * as vscode from "vscode";
import { MiseTomlTaskSymbolProvider } from "./MiseTomlTaskSymbolProvider";
import { describe, expect, it, mock } from "bun:test";

class MockDocumentSymbol {
    constructor(
        public name: string,
        public detail: string,
        public kind: vscode.SymbolKind,
        public range: vscode.Range,
        public selectionRange: vscode.Range,
    ) {}
}

const MockSymbolKind = {
    Function: 1,
    Property: 2,
};

const provider = new MiseTomlTaskSymbolProvider({
    DocumentSymbol: MockDocumentSymbol as any,
    SymbolKind: MockSymbolKind as any,
    Range: vscode.Range as any,
    Position: vscode.Position as any,
});

describe("MiseTomlTaskSymbolProvider tests", () => {
    it("provides symbols for tasks sections and trivial key-value pairs", () => {
        const document = {
            getText: () =>
                `
[tasks]
key1 = "value1"
"key2"= "value2"
"complex \"key\" 3" = "value3"

[tasks.example]
key_example = "value4"

[tasks."complex [\"section\"] name"]
key_complex = "value5"

[other]
key_other = "value6"
`.trim(),
        } as vscode.TextDocument;
        
        console.log("vscode resolve:", require.resolve("vscode"));
console.log("vscode version:", (vscode as any).version);
        const symbols = provider.provideDocumentSymbols(document, {} as vscode.CancellationToken) as MockDocumentSymbol[];

        expect(symbols).toEqual([
            // only trivial key-value pairs should be included as symbols from "tasks" section
            new MockDocumentSymbol(
                "key1",
                '"value1"',
                MockSymbolKind.Property,
                new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 15)),
                new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 15)),
            ),
            new MockDocumentSymbol(
                "key2",
                '"value2"',
                MockSymbolKind.Property,
                new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 16)),
                new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 16)),
            ),
            new MockDocumentSymbol(
                'complex "key" 3',
                '"value3"',
                MockSymbolKind.Property,
                new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, 28)),
                new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, 28)),
            ),

            // "example" and "complex [\"section\"] name" sections should be included as symbols
            new MockDocumentSymbol(
                "example",
                "",
                MockSymbolKind.Function,
                new vscode.Range(new vscode.Position(5, 0), new vscode.Position(5, 15)),
                new vscode.Range(new vscode.Position(5, 0), new vscode.Position(5, 15)),
            ),
            new MockDocumentSymbol(
                'complex ["section"] name',
                '',
                MockSymbolKind.Function,
                new vscode.Range(new vscode.Position(8, 0), new vscode.Position(8, 34)),
                new vscode.Range(new vscode.Position(8, 0), new vscode.Position(8, 34)),
            ),

            // "other" section should be ignored, as it's not a "tasks" section
        ]);
    });
});
    