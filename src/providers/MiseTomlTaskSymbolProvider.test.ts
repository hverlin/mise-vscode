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
[tools]
key_tool = "value_tool"

[env]
env_key = "value_env"
env_key2 = "value_env2"

[settings]
setting_key = "value_setting"

[tasks]
key1 = "value1"
"key2"= "value2"
"complex \\"key\\" 3" = "value3"

[tasks.example]
key_example = "value4"

[tasks."complex [\\"section\\"] name"]
key_complex = "value5"

[other]
key_other = "value6"
`.trim(),
        } as vscode.TextDocument;
        const toolsSectionLength = "[tools]".length;
        const envSectionLength = "[env]".length;
        const settinsSectionLength = "[settings]".length;

        const key1Length = 'key1 = "value1"'.length;
        const key2Length = '"key2"= "value2"'.length;
        const complexKey3Length = '"complex \\"key\\" 3" = "value3"'.length;

        const exampleSectionLength = "[tasks.example]".length;
        const complexSectionLength = '[tasks."complex [\\"section\\"] name"]'.length;
        
        const symbols = provider.provideDocumentSymbols(document, {} as vscode.CancellationToken) as MockDocumentSymbol[];

        expect(symbols).toEqual([
            new MockDocumentSymbol(
                "[tools]",
                '',
                undefined as any,
                new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, toolsSectionLength)),
                new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, toolsSectionLength)),
            ),
            // only trivial key-value pairs should be included as symbols from "tasks" section
            new MockDocumentSymbol(
                "[env]",
                '',
                undefined as any,
                new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, envSectionLength)),
                new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, envSectionLength)),
            ),
            new MockDocumentSymbol(
                "[settings]",
                '',
                undefined as any,
                new vscode.Range(new vscode.Position(7, 0), new vscode.Position(7, settinsSectionLength)),
                new vscode.Range(new vscode.Position(7, 0), new vscode.Position(7, settinsSectionLength)),
            ),
            new MockDocumentSymbol(
                "key1",
                'value1',
                undefined as any,
                new vscode.Range(new vscode.Position(11, 0), new vscode.Position(11, key1Length)),
                new vscode.Range(new vscode.Position(11, 0), new vscode.Position(11, key1Length)),
            ),
            new MockDocumentSymbol(
                "key2",
                'value2',
                undefined as any,
                new vscode.Range(new vscode.Position(12, 0), new vscode.Position(12, key2Length)),
                new vscode.Range(new vscode.Position(12, 0), new vscode.Position(12, key2Length)),
            ),
            new MockDocumentSymbol(
                'complex "key" 3',
                'value3',
                undefined as any,
                new vscode.Range(new vscode.Position(13, 0), new vscode.Position(13, complexKey3Length)),
                new vscode.Range(new vscode.Position(13, 0), new vscode.Position(13, complexKey3Length)),
            ),

            // "example" and "complex [\"section\"] name" sections should be included as symbols
            new MockDocumentSymbol(
                "example",
                "",
                undefined as any,
                new vscode.Range(new vscode.Position(15, 0), new vscode.Position(15, exampleSectionLength)),
                new vscode.Range(new vscode.Position(15, 0), new vscode.Position(15, exampleSectionLength)),
            ),
            new MockDocumentSymbol(
                'complex ["section"] name',
                '',
                undefined as any,
                new vscode.Range(new vscode.Position(18, 0), new vscode.Position(18, complexSectionLength)),
                new vscode.Range(new vscode.Position(18, 0), new vscode.Position(18, complexSectionLength)),
            ),

            // "other" section should be ignored, as it's not a "tasks" section
        ]);
    });
});
    