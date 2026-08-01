import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import {
	extractToolNamesFromLine,
	extractToolVersionFromLine,
	extractToolVersionFromSection,
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

describe("extractToolNamesFromLine", () => {
	describe("[tools] block — bare key definitions", () => {
		it('parses simple bare key: pkl = "0.29.1"', () => {
			expect(extractToolNamesFromLine('pkl = "0.29.1"')).toEqual(["pkl"]);
		});

		it("parses single-quoted value: node = '24'", () => {
			expect(extractToolNamesFromLine("node = '24'")).toEqual(["node"]);
		});

		it('parses bare key with double-quoted value: hk = "1.18.0"', () => {
			expect(extractToolNamesFromLine('hk = "1.18.0"')).toEqual(["hk"]);
		});

		it('parses quoted key with colon: "github:cli/cli" = "latest"', () => {
			expect(extractToolNamesFromLine('"github:cli/cli" = "latest"')).toEqual([
				"github:cli/cli",
			]);
		});

		it('parses quoted key with inline table: "github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }', () => {
			expect(
				extractToolNamesFromLine(
					'"github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }',
				),
			).toEqual(["github:cli/cli"]);
		});

		it('parses quoted key with api_url containing github: "github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" } # Not installed', () => {
			expect(
				extractToolNamesFromLine(
					'"github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }  # Not installed',
				),
			).toEqual(["github:cli/cli"]);
		});
	});

	describe("tasks inline tools = { ... }", () => {
		it("parses inline table: tools = { bun = 'latest', node = '18' }", () => {
			const result = extractToolNamesFromLine(
				"tools = { bun = 'latest', node = '18' }",
			);
			expect(result).toEqual(["bun", "node"]);
		});

		it("parses inline table with comment: # tools = { bun = 'latest', node = '18' }", () => {
			const result = extractToolNamesFromLine(
				"# tools = { bun = 'latest', node = '18' }",
			);
			expect(result).toEqual([]);
		});
	});

	describe("tasks tools.key = value", () => {
		it("parses tools.node = 'latest'", () => {
			expect(extractToolNamesFromLine("tools.node = 'latest'")).toEqual([
				"node",
			]);
		});

		it("parses tools.pkl = 'latest'", () => {
			expect(extractToolNamesFromLine("tools.pkl = 'latest'")).toEqual(["pkl"]);
		});

		it("parses tools.\"github:cli/cli\" = 'latest'", () => {
			expect(
				extractToolNamesFromLine("tools.\"github:cli/cli\" = 'latest'"),
			).toEqual(["github:cli/cli"]);
		});

		it("parses tools.'github:cli/cli' = 'latest' (single-quoted key)", () => {
			expect(
				extractToolNamesFromLine("tools.'github:cli/cli' = 'latest'"),
			).toEqual(["github:cli/cli"]);
		});

		it("parses tools.node with comment: tools.node = 'latest' # node: 24.11.0", () => {
			expect(
				extractToolNamesFromLine("tools.node = 'latest' # node: 24.11.0"),
			).toEqual(["node"]);
		});
	});

	describe("[tools.X] section headers", () => {
		it("parses [tools.node]", () => {
			expect(extractToolNamesFromLine("[tools.node]")).toEqual(["node"]);
		});

		it('parses [tools."github:cli/cli"]', () => {
			expect(extractToolNamesFromLine('[tools."github:cli/cli"]')).toEqual([
				"github:cli/cli",
			]);
		});

		it("parses [tools.'npm:prettier'] (single-quoted key)", () => {
			expect(extractToolNamesFromLine("[tools.'npm:prettier']")).toEqual([
				"npm:prettier",
			]);
		});

		it('does not treat sub-tables as tools: [tools."http:my-tool".platforms]', () => {
			expect(
				extractToolNamesFromLine('[tools."http:my-tool".platforms]'),
			).toEqual([]);
		});

		it("does not treat bare sub-tables as tools: [tools.node.platforms]", () => {
			expect(extractToolNamesFromLine("[tools.node.platforms]")).toEqual([]);
		});

		it("returns nothing for [tools] itself", () => {
			expect(extractToolNamesFromLine("[tools]")).toEqual([]);
		});

		it("returns nothing for other sections: [tasks.build]", () => {
			expect(extractToolNamesFromLine("[tasks.build]")).toEqual([]);
		});

		it("filters header tools by word", () => {
			expect(extractToolNamesFromLine("[tools.node]", "node")).toEqual([
				"node",
			]);
			expect(extractToolNamesFromLine("[tools.node]", "tools")).toEqual([]);
		});
	});

	describe("dotted keys", () => {
		it('parses node.version = "22" as node', () => {
			expect(extractToolNamesFromLine('node.version = "22"')).toEqual(["node"]);
		});

		it('parses "ubi:sharkdp/fd".version = "latest" as ubi:sharkdp/fd', () => {
			expect(
				extractToolNamesFromLine('"ubi:sharkdp/fd".version = "latest"'),
			).toEqual(["ubi:sharkdp/fd"]);
		});

		it("parses tools.node.version = '22' as node", () => {
			expect(extractToolNamesFromLine("tools.node.version = '22'")).toEqual([
				"node",
			]);
		});

		it("parses tools.\"npm:prettier\".version = 'latest' as npm:prettier", () => {
			expect(
				extractToolNamesFromLine("tools.\"npm:prettier\".version = 'latest'"),
			).toEqual(["npm:prettier"]);
		});
	});

	describe("array and inline-table values", () => {
		it("parses multiple versions array: python = ['3.10', '3.11']", () => {
			expect(extractToolNamesFromLine("python = ['3.10', '3.11']")).toEqual([
				"python",
			]);
		});

		it('parses inline table with options: ripgrep = { version = "latest", os = ["linux", "macos"] }', () => {
			expect(
				extractToolNamesFromLine(
					'ripgrep = { version = "latest", os = ["linux", "macos"] }',
				),
			).toEqual(["ripgrep"]);
		});
	});

	describe("word filtering", () => {
		it("filters inline tools by word (bun)", () => {
			const result = extractToolNamesFromLine(
				"tools = { bun = 'latest', node = '18' }",
				"bun",
			);
			expect(result).toEqual(["bun"]);
		});

		it("filters inline tools by word (node)", () => {
			const result = extractToolNamesFromLine(
				"tools = { bun = 'latest', node = '18' }",
				"node",
			);
			expect(result).toEqual(["node"]);
		});

		it("finds github:cli/cli when searching for 'cli'", () => {
			const result = extractToolNamesFromLine(
				'"github:cli/cli" = "latest"',
				"cli",
			);
			expect(result).toEqual(["github:cli/cli"]);
		});
	});
});

describe("extractToolVersionFromLine", () => {
	describe("[tools] block", () => {
		it('extracts version from: pkl = "0.29.1"', () => {
			expect(extractToolVersionFromLine('pkl = "0.29.1"', "pkl")).toBe(
				"0.29.1",
			);
		});

		it("extracts version from: node = '24'", () => {
			expect(extractToolVersionFromLine("node = '24'", "node")).toBe("24");
		});

		it('extracts version from: hk = "1.18.0"', () => {
			expect(extractToolVersionFromLine('hk = "1.18.0"', "hk")).toBe("1.18.0");
		});

		it('extracts version from inline table: "github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }', () => {
			expect(
				extractToolVersionFromLine(
					'"github:cli/cli" = { version = "latest", api_url = "https://github.com/api/v3" }',
					"github:cli/cli",
				),
			).toBe("latest");
		});
	});

	describe("tools.key = val", () => {
		it("extracts version from: tools.pkl = 'latest'", () => {
			expect(extractToolVersionFromLine("tools.pkl = 'latest'", "pkl")).toBe(
				"latest",
			);
		});

		it("extracts version from: tools.node = 'latest'", () => {
			expect(extractToolVersionFromLine("tools.node = 'latest'", "node")).toBe(
				"latest",
			);
		});

		it("extracts version from: tools.\"github:cli/cli\" = 'latest'", () => {
			expect(
				extractToolVersionFromLine(
					"tools.\"github:cli/cli\" = 'latest'",
					"github:cli/cli",
				),
			).toBe("latest");
		});

		it("extracts version with trailing comment: tools.node = 'latest' # node: 24.11.0", () => {
			expect(
				extractToolVersionFromLine(
					"tools.node = 'latest' # node: 24.11.0",
					"node",
				),
			).toBe("latest");
		});
	});

	describe("inline table tools = { ... }", () => {
		it("extracts bun version from inline table", () => {
			expect(
				extractToolVersionFromLine(
					"tools = { bun = 'latest', node = '18' }",
					"bun",
				),
			).toBe("latest");
		});

		it("extracts node version from inline table", () => {
			expect(
				extractToolVersionFromLine(
					"tools = { bun = 'latest', node = '18' }",
					"node",
				),
			).toBe("18");
		});
	});

	describe("dotted keys", () => {
		it('extracts version from: node.version = "22"', () => {
			expect(extractToolVersionFromLine('node.version = "22"', "node")).toBe(
				"22",
			);
		});

		it('extracts version from: "ubi:sharkdp/fd".version = "latest"', () => {
			expect(
				extractToolVersionFromLine(
					'"ubi:sharkdp/fd".version = "latest"',
					"ubi:sharkdp/fd",
				),
			).toBe("latest");
		});

		it("extracts version from: tools.node.version = '22'", () => {
			expect(
				extractToolVersionFromLine("tools.node.version = '22'", "node"),
			).toBe("22");
		});

		it("returns undefined for non-version options: node.postinstall = 'echo hi'", () => {
			expect(
				extractToolVersionFromLine("node.postinstall = 'echo hi'", "node"),
			).toBeUndefined();
		});
	});

	describe("arrays of versions", () => {
		it("extracts first version from: python = ['3.10', '3.11']", () => {
			expect(
				extractToolVersionFromLine("python = ['3.10', '3.11']", "python"),
			).toBe("3.10");
		});

		it('extracts first version from: node = ["20", "22"]', () => {
			expect(extractToolVersionFromLine('node = ["20", "22"]', "node")).toBe(
				"20",
			);
		});
	});

	describe("inline table with extra options", () => {
		it('extracts version from: ripgrep = { version = "latest", os = ["linux", "macos"] }', () => {
			expect(
				extractToolVersionFromLine(
					'ripgrep = { version = "latest", os = ["linux", "macos"] }',
					"ripgrep",
				),
			).toBe("latest");
		});

		it('returns undefined when there is no version: node = { postinstall = "corepack enable" }', () => {
			expect(
				extractToolVersionFromLine(
					'node = { postinstall = "corepack enable" }',
					"node",
				),
			).toBeUndefined();
		});
	});
});

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

describe("extractToolVersionFromSection", () => {
	it("extracts a string version from the section body", () => {
		const doc = fakeDocument(
			[
				"[tools.node]",
				'postinstall = "corepack enable"',
				'version = "22"',
			].join("\n"),
		);
		expect(extractToolVersionFromSection(doc, 0)).toBe("22");
	});

	it("extracts the first entry of a version array", () => {
		const doc = fakeDocument(
			["[tools.python]", 'version = ["3.10", "3.11"]'].join("\n"),
		);
		expect(extractToolVersionFromSection(doc, 0)).toBe("3.10");
	});

	it("stops at the next section header", () => {
		const doc = fakeDocument(
			[
				"[tools.node]",
				'postinstall = "corepack enable"',
				"[tools.python]",
				'version = "3.12"',
			].join("\n"),
		);
		expect(extractToolVersionFromSection(doc, 0)).toBeUndefined();
		expect(extractToolVersionFromSection(doc, 2)).toBe("3.12");
	});
});
