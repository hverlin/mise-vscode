import { beforeEach, describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import { MiseTomlTaskSymbolProvider } from "./MiseTomlTaskSymbolProvider";

class MockDocumentSymbol {
	children: MockDocumentSymbol[] = [];
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
	it("provides hierarchical symbols for all sections", () => {
		const document = {
			getText: () => multiSymbolMiseToml,
		} as vscode.TextDocument;

		const symbols = provider.provideDocumentSymbols(
			document,
			{} as vscode.CancellationToken,
		) as MockDocumentSymbol[];

		// Should have 5 top-level sections: tools, env, settings, tasks, other
		expect(symbols.length).toBe(5);

		expect(symbols[0]?.name).toBe("[tools]");
		expect(symbols[0]?.kind).toBe(MockSymbolKind.Namespace);
		expect(symbols[0]?.children.length).toBe(1);
		expect(symbols[0]?.children[0]?.name).toBe("key_tool");
		expect(symbols[0]?.children[0]?.detail).toBe("value_tool");

		expect(symbols[1]?.name).toBe("[env]");
		expect(symbols[1]?.kind).toBe(MockSymbolKind.Namespace);
		expect(symbols[1]?.children.length).toBe(2);
		expect(symbols[1]?.children[0]?.name).toBe("env_key");
		expect(symbols[1]?.children[1]?.name).toBe("env_key2");

		expect(symbols[2]?.name).toBe("[settings]");
		expect(symbols[2]?.kind).toBe(MockSymbolKind.Namespace);
		expect(symbols[2]?.children.length).toBe(1);
		expect(symbols[2]?.children[0]?.name).toBe("setting_key");

		expect(symbols[3]?.name).toBe("[tasks]");
		expect(symbols[3]?.kind).toBe(MockSymbolKind.Namespace);
		expect(symbols[3]?.children.length).toBe(5);

		expect(symbols[3]?.children[0]?.name).toBe("key1");
		expect(symbols[3]?.children[0]?.detail).toBe("value1");
		expect(symbols[3]?.children[0]?.kind).toBe(MockSymbolKind.Property);
		expect(symbols[3]?.children[1]?.name).toBe("key2");
		expect(symbols[3]?.children[1]?.kind).toBe(MockSymbolKind.Property);
		expect(symbols[3]?.children[2]?.name).toBe('complex "key" 3');
		expect(symbols[3]?.children[2]?.kind).toBe(MockSymbolKind.Property);

		expect(symbols[3]?.children[3]?.name).toBe("example");
		expect(symbols[3]?.children[3]?.kind).toBe(MockSymbolKind.Function);
		expect(symbols[3]?.children[4]?.name).toBe('complex ["section"] name');
		expect(symbols[3]?.children[4]?.kind).toBe(MockSymbolKind.Function);

		expect(symbols[4]?.name).toBe("[other]");
		expect(symbols[4]?.kind).toBe(MockSymbolKind.Namespace);
		expect(symbols[4]?.children.length).toBe(1);
		expect(symbols[4]?.children[0]?.name).toBe("key_other");
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
