import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import {
	getConfigRootsArrayContext,
	getTaskNameValueContext,
	isPositionInTasksContext,
	isPositionInToolsContext,
	parseExtendsValuePrefix,
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

describe("getConfigRootsArrayContext", () => {
	const position = (line: number, character: number) =>
		({ line, character }) as vscode.Position;

	const doc = fakeDocument(
		[
			/* 0 */ "monorepo_root = true",
			/* 1 */ "",
			/* 2 */ "[monorepo]",
			/* 3 */ "config_roots = [",
			/* 4 */ '\t"projects/*",',
			/* 5 */ '\t"crates/agent', // being typed, quote still open
			/* 6 */ "\t", // empty element position
			/* 7 */ "]",
			/* 8 */ "",
			/* 9 */ "[tasks.build]",
			/* 10 */ 'depends = ["projects',
		].join("\n"),
	);

	it("detects the cursor inside an open string of a multiline array", () => {
		expect(getConfigRootsArrayContext(doc, position(5, 14))).toEqual({
			inQuote: true,
			partial: "crates/agent",
		});
	});

	it("detects an element position outside a string", () => {
		expect(getConfigRootsArrayContext(doc, position(6, 1))).toEqual({
			inQuote: false,
			partial: "",
		});
	});

	it("ignores completed elements on the cursor line", () => {
		expect(getConfigRootsArrayContext(doc, position(4, 13))).toEqual({
			inQuote: false,
			partial: "",
		});
	});

	it("captures a bare token typed without quotes", () => {
		const bare = fakeDocument(
			["[monorepo]", "config_roots = [", '\t"crates/*",', "\tpro"].join("\n"),
		);
		expect(getConfigRootsArrayContext(bare, position(3, 4))).toEqual({
			inQuote: false,
			partial: "pro",
		});
	});

	it("is not in context after the array is closed", () => {
		expect(getConfigRootsArrayContext(doc, position(8, 0))).toBeUndefined();
	});

	it("is not in context in other arrays", () => {
		expect(getConfigRootsArrayContext(doc, position(10, 20))).toBeUndefined();
	});

	it("detects single-line arrays", () => {
		const singleLine = fakeDocument(
			["[monorepo]", 'config_roots = ["projects/'].join("\n"),
		);
		expect(getConfigRootsArrayContext(singleLine, position(1, 26))).toEqual({
			inQuote: true,
			partial: "projects/",
		});
	});

	it("detects dotted monorepo.config_roots assignments", () => {
		const dotted = fakeDocument('monorepo.config_roots = ["cra');
		expect(getConfigRootsArrayContext(dotted, position(0, 29))).toEqual({
			inQuote: true,
			partial: "cra",
		});
	});

	it("requires the [monorepo] section", () => {
		const wrongSection = fakeDocument(
			["[settings]", 'config_roots = ["projects/'].join("\n"),
		);
		expect(
			getConfigRootsArrayContext(wrongSection, position(1, 26)),
		).toBeUndefined();
	});

	it("requires a section header for a bare config_roots key", () => {
		const noSection = fakeDocument('config_roots = ["projects/');
		expect(
			getConfigRootsArrayContext(noSection, position(0, 26)),
		).toBeUndefined();
	});
});

describe("isPositionInTasksContext", () => {
	const doc = fakeDocument(
		[
			"[tools]", // 0
			'node = "22"', // 1
			"", // 2
			"[tasks]", // 3
			'build = { extends = "base" }', // 4
			"", // 5
			"[tasks.test]", // 6
			'extends = "base"', // 7
			"", // 8
			"[task_templates.base]", // 9
			'run = "echo hi"', // 10
			"", // 11
			'tasks.lint = { extends = "base" }', // 12
		].join("\n"),
	);

	it("is true inside a [tasks] section", () => {
		expect(isPositionInTasksContext(doc, positionAt(4))).toBe(true);
	});

	it("is true inside a [tasks.<name>] section and on its header", () => {
		expect(isPositionInTasksContext(doc, positionAt(6))).toBe(true);
		expect(isPositionInTasksContext(doc, positionAt(7))).toBe(true);
	});

	it("is true on a dotted tasks assignment", () => {
		expect(isPositionInTasksContext(doc, positionAt(12))).toBe(true);
	});

	it("is false in [task_templates] and other sections", () => {
		expect(isPositionInTasksContext(doc, positionAt(10))).toBe(false);
		expect(isPositionInTasksContext(doc, positionAt(1))).toBe(false);
	});

	it("is false without any section header", () => {
		expect(
			isPositionInTasksContext(fakeDocument('run = "x"'), positionAt(0)),
		).toBe(false);
	});
});

describe("parseExtendsValuePrefix", () => {
	it("parses a partially typed name", () => {
		expect(parseExtendsValuePrefix('extends = "py')).toEqual({
			quote: '"',
			partial: "py",
		});
	});

	it("parses an empty value, quoted or not", () => {
		expect(parseExtendsValuePrefix("extends = ")).toEqual({
			quote: "",
			partial: "",
		});
		expect(parseExtendsValuePrefix("extends = '")).toEqual({
			quote: "'",
			partial: "",
		});
	});

	it("parses an extends key of an inline table", () => {
		expect(parseExtendsValuePrefix('info = { extends = "pro')).toEqual({
			quote: '"',
			partial: "pro",
		});
	});

	it("returns undefined outside of an extends value", () => {
		expect(parseExtendsValuePrefix('run = "echo')).toBeUndefined();
		expect(parseExtendsValuePrefix('extends = "base"')).toBeUndefined();
		expect(parseExtendsValuePrefix('depends_extends = "b')).toBeUndefined();
	});
});

describe("getTaskNameValueContext", () => {
	/** Context at the cursor, marked with `|` in the toml passed in */
	const contextAt = (toml: string) => {
		const lines = toml.split("\n");
		const line = lines.findIndex((text) => text.includes("|"));
		const character = (lines[line] ?? "").indexOf("|");
		return getTaskNameValueContext(fakeDocument(toml.replace("|", "")), {
			line,
			character,
		} as vscode.Position);
	};

	describe("run entries", () => {
		it("completes the task of an entry", () => {
			expect(contextAt('[tasks.a]\nrun = [{ task = "l|" }]')).toEqual({
				inQuote: true,
			});
		});

		it("completes the tasks of a parallel entry", () => {
			expect(contextAt('[tasks.a]\nrun = [{ tasks = ["t2", "t|"] }]')).toEqual({
				inQuote: true,
			});
		});

		it("completes a multiline array", () => {
			expect(
				contextAt(
					[
						"[tasks.grouped]",
						"run = [",
						'  { task = "t1" },',
						'  { task = "t|" },',
						'  "echo end",',
						"]",
					].join("\n"),
				),
			).toEqual({ inQuote: true });
		});

		it("completes an entry before its quotes are typed", () => {
			expect(contextAt("[tasks.a]\nrun = [{ task = | }]")).toEqual({
				inQuote: false,
			});
		});

		it("ignores shell commands", () => {
			expect(contextAt('[tasks.a]\nrun = "echo |"')).toBeUndefined();
			expect(contextAt('[tasks.a]\nrun = ["echo |"]')).toBeUndefined();
			expect(
				contextAt('[tasks.a]\nrun = [{ task = "b" }, "echo |"]'),
			).toBeUndefined();
		});

		it("ignores the args and env of an entry", () => {
			expect(
				contextAt('[tasks.a]\nrun = [{ task = "b", args = ["--re|"] }]'),
			).toBeUndefined();
			expect(
				contextAt('[tasks.a]\nrun = [{ task = "b", env = { RUST = "|" } }]'),
			).toBeUndefined();
		});

		it("completes run_windows too", () => {
			expect(contextAt('[tasks.a]\nrun_windows = [{ task = "|" }]')).toEqual({
				inQuote: true,
			});
		});
	});

	describe("depends entries", () => {
		it("completes an array entry", () => {
			expect(contextAt('[tasks.a]\ndepends = ["bu|"]')).toEqual({
				inQuote: true,
			});
			expect(contextAt('[tasks.a]\nwait_for = ["bu|"]')).toEqual({
				inQuote: true,
			});
			expect(contextAt('[tasks.a]\ndepends_post = ["bu|"]')).toEqual({
				inQuote: true,
			});
		});

		it("completes a bare string value", () => {
			expect(contextAt('[tasks.a]\ndepends = "bu|"')).toEqual({
				inQuote: true,
			});
			expect(contextAt("[tasks.a]\ndepends = |")).toEqual({ inQuote: false });
		});

		it("completes the task of an inline table entry", () => {
			expect(
				contextAt('[tasks.a]\ndepends = [{ task = "b|", optional = true }]'),
			).toEqual({ inQuote: true });
		});

		it("ignores the other keys of an inline table entry", () => {
			expect(
				contextAt('[tasks.a]\ndepends = [{ task = "b", optional = |true }]'),
			).toBeUndefined();
		});

		it("completes only the task of a [task, args] entry", () => {
			expect(contextAt('[tasks.a]\ndepends = [["bu|"]]')).toEqual({
				inQuote: true,
			});
			expect(
				contextAt('[tasks.a]\ndepends = [["build", "--ar|"]]'),
			).toBeUndefined();
		});

		it("completes a dotted assignment and an inline task table", () => {
			expect(contextAt('tasks.a.depends = ["bu|"]')).toEqual({ inQuote: true });
			expect(contextAt('tasks.a = { depends = ["bu|"] }')).toEqual({
				inQuote: true,
			});
			expect(contextAt('tasks.a = { run = [{ task = "bu|" }] }')).toEqual({
				inQuote: true,
			});
		});
	});

	it("returns undefined outside a task reference", () => {
		expect(contextAt('[tasks.a]\ndescription = "bu|"')).toBeUndefined();
		expect(contextAt('[tasks.a]\nsources = ["src/|"]')).toBeUndefined();
		expect(contextAt('[tasks.a]\ndepends = ["build"] |')).toBeUndefined();
		expect(contextAt('[tasks.a]\ndepends = ["build"]\n|')).toBeUndefined();
		expect(contextAt('[tasks.a]\nrun = [{ |task = "b" }]')).toBeUndefined();
	});
});
