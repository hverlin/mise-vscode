import { beforeEach, describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import { MiseTomlTaskSymbolProvider } from "./MiseTomlTaskSymbolProvider";

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
	Property: 1,
	Function: 2,
	Namespace: 3,
};

class VSCodeMock {
	DocumentSymbol = MockDocumentSymbol;
	Range = vscode.Range;
	Position = vscode.Position;
	SymbolKind = MockSymbolKind;
}

let provider: MiseTomlTaskSymbolProvider;

const multiSymbolMiseToml = `
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
`.trim();

const simpleValidMiseToml = `
[tools]
key_tool = "value_tool"

[env]
env_key = "value_env"
`.trim();

const simpleInvalidMiseToml = `
[tools
key_tool = "value_tool"

[env]
env_key = "value_env"
`.trim();

describe("MiseTomlTaskSymbolProvider tests", () => {
	beforeEach(() => {
		// Mock the logger to prevent actual logging during tests
		/* eslint-disable @typescript-eslint/no-explicit-any */
		provider = new MiseTomlTaskSymbolProvider(
			new VSCodeMock() as typeof vscode,
		);
	});
	it("provides symbols for tasks sections and trivial key-value pairs", () => {
		const document = {
			getText: () => multiSymbolMiseToml,
		} as vscode.TextDocument;
		const toolsSectionLength = "[tools]".length;
		const envSectionLength = "[env]".length;
		const settinsSectionLength = "[settings]".length;

		const key1Length = 'key1 = "value1"'.length;
		const key2Length = '"key2"= "value2"'.length;
		const complexKey3Length = '"complex \\"key\\" 3" = "value3"'.length;

		const exampleSectionLength = "[tasks.example]".length;
		const complexSectionLength = '[tasks."complex [\\"section\\"] name"]'
			.length;

		const symbols = provider.provideDocumentSymbols(
			document,
			{} as vscode.CancellationToken,
		) as MockDocumentSymbol[];

		expect(symbols).toEqual([
			new MockDocumentSymbol(
				"[tools]",
				"",
				new VSCodeMock().SymbolKind.Namespace,
				new vscode.Range(
					new vscode.Position(0, 0),
					new vscode.Position(0, toolsSectionLength),
				),
				new vscode.Range(
					new vscode.Position(0, 0),
					new vscode.Position(0, toolsSectionLength),
				),
			),
			// only trivial key-value pairs should be included as symbols from "tasks" section
			new MockDocumentSymbol(
				"[env]",
				"",
				new VSCodeMock().SymbolKind.Namespace,
				new vscode.Range(
					new vscode.Position(3, 0),
					new vscode.Position(3, envSectionLength),
				),
				new vscode.Range(
					new vscode.Position(3, 0),
					new vscode.Position(3, envSectionLength),
				),
			),
			new MockDocumentSymbol(
				"[settings]",
				"",
				new VSCodeMock().SymbolKind.Namespace,
				new vscode.Range(
					new vscode.Position(7, 0),
					new vscode.Position(7, settinsSectionLength),
				),
				new vscode.Range(
					new vscode.Position(7, 0),
					new vscode.Position(7, settinsSectionLength),
				),
			),
			new MockDocumentSymbol(
				"key1",
				"value1",
				new VSCodeMock().SymbolKind.Property,
				new vscode.Range(
					new vscode.Position(11, 0),
					new vscode.Position(11, key1Length),
				),
				new vscode.Range(
					new vscode.Position(11, 0),
					new vscode.Position(11, key1Length),
				),
			),
			new MockDocumentSymbol(
				"key2",
				"value2",
				new VSCodeMock().SymbolKind.Property,
				new vscode.Range(
					new vscode.Position(12, 0),
					new vscode.Position(12, key2Length),
				),
				new vscode.Range(
					new vscode.Position(12, 0),
					new vscode.Position(12, key2Length),
				),
			),
			new MockDocumentSymbol(
				'complex "key" 3',
				"value3",
				new VSCodeMock().SymbolKind.Property,
				new vscode.Range(
					new vscode.Position(13, 0),
					new vscode.Position(13, complexKey3Length),
				),
				new vscode.Range(
					new vscode.Position(13, 0),
					new vscode.Position(13, complexKey3Length),
				),
			),

			// "example" and "complex [\"section\"] name" sections should be included as symbols
			new MockDocumentSymbol(
				"example",
				"",
				new VSCodeMock().SymbolKind.Function,
				new vscode.Range(
					new vscode.Position(15, 0),
					new vscode.Position(15, exampleSectionLength),
				),
				new vscode.Range(
					new vscode.Position(15, 0),
					new vscode.Position(15, exampleSectionLength),
				),
			),
			new MockDocumentSymbol(
				'complex ["section"] name',
				"",
				new VSCodeMock().SymbolKind.Function,
				new vscode.Range(
					new vscode.Position(18, 0),
					new vscode.Position(18, complexSectionLength),
				),
				new vscode.Range(
					new vscode.Position(18, 0),
					new vscode.Position(18, complexSectionLength),
				),
			),

			// "other" section should be ignored, as it's not a "tasks" section
		]);
	});

	it("keeps previous symbols if cancellation is requested", () => {
		const document = {
			getText: () => simpleValidMiseToml,
		} as vscode.TextDocument;

		// First call to populate symbols
		const initialSymbols = provider.provideDocumentSymbols(
			document,
			{} as vscode.CancellationToken,
		) as MockDocumentSymbol[];

		// Simulate cancellation on second call
		const cancelledSymbols = provider.provideDocumentSymbols(document, {
			isCancellationRequested: true,
		} as vscode.CancellationToken) as MockDocumentSymbol[];

		expect(cancelledSymbols).toBe(initialSymbols);
	});

	it("returns empty symbols if TOML parsing fails and no previous symbols exist", () => {
		const invalidDocument = {
			getText: () => simpleInvalidMiseToml,
		} as vscode.TextDocument;

		const symbols = provider.provideDocumentSymbols(
			invalidDocument,
			{} as vscode.CancellationToken,
		) as MockDocumentSymbol[];

		expect(symbols).toEqual([]);
	});

	it("keeps last valid symbols if TOML parsing fails", () => {
		const validDocument = {
			getText: () => simpleValidMiseToml,
		} as vscode.TextDocument;

		const invalidDocument = {
			getText: () => simpleInvalidMiseToml,
		} as vscode.TextDocument;

		// First call with valid TOML to populate symbols
		const validSymbols = provider.provideDocumentSymbols(
			validDocument,
			{} as vscode.CancellationToken,
		) as MockDocumentSymbol[];
		// Second call with invalid TOML should keep previous symbols
		const invalidSymbols = provider.provideDocumentSymbols(
			invalidDocument,
			{} as vscode.CancellationToken,
		) as MockDocumentSymbol[];

		expect(invalidSymbols).toBe(validSymbols);
	});
});
