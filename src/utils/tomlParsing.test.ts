import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import {
	isPositionInToolsContext,
	parseInlineTableVersionPrefix,
	parseToolsSectionHeader,
	splitDottedToolKey,
} from "./tomlParsing";

function fakeDocument(content: string): vscode.TextDocument {
	const lines = content.split("\n");
	return {
		lineCount: lines.length,
		lineAt: (lineOrPosition: number | vscode.Position) => {
			const line =
				typeof lineOrPosition === "number"
					? lineOrPosition
					: lineOrPosition.line;
			return { text: lines[line] ?? "" };
		},
	} as unknown as vscode.TextDocument;
}

function positionAt(line: number): vscode.Position {
	return { line, character: 0 } as vscode.Position;
}

describe("parseToolsSectionHeader", () => {
	it("parses [tools.node]", () => {
		expect(parseToolsSectionHeader("[tools.node]")).toEqual({
			toolName: "node",
			isSubTable: false,
		});
	});

	it('parses [tools."github:cli/cli"]', () => {
		expect(parseToolsSectionHeader('[tools."github:cli/cli"]')).toEqual({
			toolName: "github:cli/cli",
			isSubTable: false,
		});
	});

	it("parses [tools.'cargo:eza']", () => {
		expect(parseToolsSectionHeader("[tools.'cargo:eza']")).toEqual({
			toolName: "cargo:eza",
			isSubTable: false,
		});
	});

	it('parses sub-table [tools."http:my-tool".platforms]', () => {
		expect(parseToolsSectionHeader('[tools."http:my-tool".platforms]')).toEqual(
			{ toolName: "http:my-tool", isSubTable: true },
		);
	});

	it("parses sub-table [tools.node.platforms]", () => {
		expect(parseToolsSectionHeader("[tools.node.platforms]")).toEqual({
			toolName: "node",
			isSubTable: true,
		});
	});

	it("handles a quoted key containing a dot", () => {
		expect(parseToolsSectionHeader('[tools."http:my.tool"]')).toEqual({
			toolName: "http:my.tool",
			isSubTable: false,
		});
	});

	it("returns undefined for [tools]", () => {
		expect(parseToolsSectionHeader("[tools]")).toBeUndefined();
	});

	it("returns undefined for [tasks.build]", () => {
		expect(parseToolsSectionHeader("[tasks.build]")).toBeUndefined();
	});

	it("returns undefined for non-header lines", () => {
		expect(parseToolsSectionHeader('node = "22"')).toBeUndefined();
	});
});

describe("splitDottedToolKey", () => {
	it("splits node → node", () => {
		expect(splitDottedToolKey("node")).toEqual({
			toolName: "node",
			optionPath: "",
		});
	});

	it("splits node.version", () => {
		expect(splitDottedToolKey("node.version")).toEqual({
			toolName: "node",
			optionPath: "version",
		});
	});

	it('splits "ubi:sharkdp/fd".version', () => {
		expect(splitDottedToolKey('"ubi:sharkdp/fd".version')).toEqual({
			toolName: "ubi:sharkdp/fd",
			optionPath: "version",
		});
	});

	it("splits quoted key without options", () => {
		expect(splitDottedToolKey("'npm:prettier'")).toEqual({
			toolName: "npm:prettier",
			optionPath: "",
		});
	});
});

describe("parseInlineTableVersionPrefix", () => {
	it('parses node = { version = "2', () => {
		expect(parseInlineTableVersionPrefix('node = { version = "2')).toEqual({
			toolName: "node",
			quote: '"',
			partial: "2",
		});
	});

	it("parses node = { version = ' (empty partial)", () => {
		expect(parseInlineTableVersionPrefix("node = { version = '")).toEqual({
			toolName: "node",
			quote: "'",
			partial: "",
		});
	});

	it("parses node = { version = (no quote yet)", () => {
		expect(parseInlineTableVersionPrefix("node = { version = ")).toEqual({
			toolName: "node",
			quote: "",
			partial: "",
		});
	});

	it('parses a quoted tool key: "github:cli/cli" = { version = "lat', () => {
		expect(
			parseInlineTableVersionPrefix('"github:cli/cli" = { version = "lat'),
		).toEqual({ toolName: "github:cli/cli", quote: '"', partial: "lat" });
	});

	it('parses a version array: python = { version = ["3.', () => {
		expect(parseInlineTableVersionPrefix('python = { version = ["3.')).toEqual({
			toolName: "python",
			quote: '"',
			partial: "3.",
		});
	});

	it("parses a version after other options: hk = { os = ['linux'], version = '1.", () => {
		expect(
			parseInlineTableVersionPrefix("hk = { os = ['linux'], version = '1."),
		).toEqual({ toolName: "hk", quote: "'", partial: "1." });
	});

	it('returns undefined when typing a non-version option: ripgrep = { version = "latest", os = ["linux', () => {
		expect(
			parseInlineTableVersionPrefix(
				'ripgrep = { version = "latest", os = ["linux',
			),
		).toBeUndefined();
	});

	it('returns undefined when typing an option key: node = { postinstall = "co', () => {
		expect(
			parseInlineTableVersionPrefix('node = { postinstall = "co'),
		).toBeUndefined();
	});

	it("returns undefined outside an inline table: node = '2", () => {
		expect(parseInlineTableVersionPrefix("node = '2")).toBeUndefined();
	});
});

describe("isPositionInToolsContext", () => {
	const doc = fakeDocument(
		[
			"[tools]", // 0
			'node = "22"', // 1
			"", // 2
			"[tools.python]", // 3
			'version = "3.12"', // 4
			'postinstall = "echo done"', // 5
			"", // 6
			'[tools."http:my-tool".platforms]', // 7
			'macos-x64 = { url = "https://example.com" }', // 8
			"", // 9
			"[tasks.build]", // 10
			'run = "echo build"', // 11
			"tools = { bun = 'latest' }", // 12
			"tools.node = 'latest'", // 13
		].join("\n"),
	);

	it("detects lines in a [tools] block", () => {
		expect(isPositionInToolsContext(doc, positionAt(1))).toEqual({
			inContext: true,
			isInline: false,
			inToolOptionsSection: false,
		});
	});

	it("detects a [tools.python] header as a declaration line", () => {
		expect(isPositionInToolsContext(doc, positionAt(3))).toEqual({
			inContext: true,
			isInline: false,
			inToolOptionsSection: false,
			sectionToolName: "python",
		});
	});

	it("flags option lines inside [tools.python]", () => {
		for (const line of [4, 5]) {
			expect(isPositionInToolsContext(doc, positionAt(line))).toEqual({
				inContext: true,
				isInline: false,
				inToolOptionsSection: true,
				sectionToolName: "python",
			});
		}
	});

	it("flags lines inside a platforms sub-table as options", () => {
		expect(isPositionInToolsContext(doc, positionAt(8))).toEqual({
			inContext: true,
			isInline: false,
			inToolOptionsSection: true,
			sectionToolName: "http:my-tool",
		});
	});

	it("does not flag lines in a [tasks.*] block", () => {
		expect(isPositionInToolsContext(doc, positionAt(11)).inContext).toBe(false);
	});

	it("detects inline tools tables in tasks", () => {
		expect(isPositionInToolsContext(doc, positionAt(12))).toEqual({
			inContext: true,
			isInline: true,
			inToolOptionsSection: false,
		});
	});

	it("detects tools.key lines in tasks", () => {
		expect(isPositionInToolsContext(doc, positionAt(13))).toEqual({
			inContext: true,
			isInline: true,
			inToolOptionsSection: false,
		});
	});
});
