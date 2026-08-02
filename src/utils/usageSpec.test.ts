import { describe, expect, test } from "bun:test";
import {
	getEnclosingTaskUsageLines,
	getFileTaskConfigHoverInfo,
	getUsageCompletionItems,
	getUsageCursorContext,
	getUsageHoverInfo,
	getUsageVariableNames,
	isInsideUsageString,
	type UsageCursorContext,
} from "./usageSpec";

describe("isInsideUsageString", () => {
	const doc = (text: string) => text.split("\n");

	test("detects position inside a usage multiline string", () => {
		const lines = doc(`[tasks.deploy]
description = "Deploy the app"
usage = '''
arg "<environment>"
flag "-v --verbose"
'''
run = 'echo hello'`);

		expect(isInsideUsageString(lines, { line: 3, character: 0 })).toBe(true);
		expect(isInsideUsageString(lines, { line: 4, character: 10 })).toBe(true);
	});

	test("detects position on the opening line after the quotes", () => {
		const lines = doc(`[tasks.deploy]
usage = '''
'''`);

		expect(isInsideUsageString(lines, { line: 1, character: 12 })).toBe(true);
		expect(isInsideUsageString(lines, { line: 1, character: 3 })).toBe(false);
	});

	test("supports double-quoted multiline strings", () => {
		const lines = doc(`[tasks.deploy]
usage = """
arg "<file>"
"""`);

		expect(isInsideUsageString(lines, { line: 2, character: 0 })).toBe(true);
	});

	test("returns false outside the usage string", () => {
		const lines = doc(`[tasks.deploy]
usage = '''
arg "<environment>"
'''
run = 'echo hello'`);

		expect(isInsideUsageString(lines, { line: 0, character: 0 })).toBe(false);
		expect(isInsideUsageString(lines, { line: 1, character: 0 })).toBe(false);
		expect(isInsideUsageString(lines, { line: 4, character: 5 })).toBe(false);
	});

	test("returns false for single-line usage strings", () => {
		const lines = doc(`[tasks.deploy]
usage = '''arg "<file>"'''
run = 'echo hello'`);

		expect(isInsideUsageString(lines, { line: 1, character: 15 })).toBe(false);
		expect(isInsideUsageString(lines, { line: 2, character: 0 })).toBe(false);
	});

	test("returns false inside other multiline strings", () => {
		const lines = doc(`[tasks.deploy]
run = '''
echo "running"
'''`);

		expect(isInsideUsageString(lines, { line: 2, character: 0 })).toBe(false);
	});

	test("returns false after a new table header", () => {
		const lines = doc(`[tasks.deploy]
usage = '''
arg "<file>"
'''

[tasks.other]
run = 'echo'`);

		expect(isInsideUsageString(lines, { line: 6, character: 0 })).toBe(false);
	});

	test("handles out-of-range positions", () => {
		expect(isInsideUsageString([], { line: 5, character: 0 })).toBe(false);
	});
});

describe("getUsageCursorContext", () => {
	test("start of a line offers directives", () => {
		expect(getUsageCursorContext([], "")).toEqual({ kind: "directive" });
		expect(getUsageCursorContext([], "f")).toEqual({ kind: "directive" });
		expect(getUsageCursorContext(['arg "<file>"'], "fl")).toEqual({
			kind: "directive",
		});
	});

	test("after a directive and its name offers attributes", () => {
		expect(getUsageCursorContext([], 'arg "<file>" ')).toEqual({
			kind: "attribute",
			directive: "arg",
			used: [],
		});
		expect(getUsageCursorContext([], 'flag "-v --verbose" h')).toEqual({
			kind: "attribute",
			directive: "flag",
			used: [],
		});
		expect(
			getUsageCursorContext([], 'flag "--format <format>" help="Format" '),
		).toEqual({ kind: "attribute", directive: "flag", used: ["help"] });
	});

	test("tracks attributes already used on the line", () => {
		expect(
			getUsageCursorContext(
				[],
				'flag "--name" help="Flag description" count=#true ',
			),
		).toEqual({
			kind: "attribute",
			directive: "flag",
			used: ["help", "count"],
		});
	});

	test("recognizes the complete directive", () => {
		expect(getUsageCursorContext([], 'complete "plugin" ')).toEqual({
			kind: "attribute",
			directive: "complete",
			used: [],
		});
	});

	test("inside an arg/flag block offers block items", () => {
		expect(getUsageCursorContext(['arg "<env>" {'], "")).toEqual({
			kind: "block",
			directive: "arg",
			used: [],
		});
		expect(
			getUsageCursorContext(['flag "--format <format>" {'], "cho"),
		).toEqual({ kind: "block", directive: "flag", used: [] });
		// block opened on the current line
		expect(getUsageCursorContext([], 'arg "<env>" { ')).toEqual({
			kind: "block",
			directive: "arg",
			used: [],
		});
	});

	test("tracks nodes already present in a block", () => {
		expect(
			getUsageCursorContext(['arg "<env>" {', '  choices "a" "b"'], ""),
		).toEqual({ kind: "block", directive: "arg", used: ["choices"] });
	});

	test("a closed block is back at the directive level", () => {
		expect(getUsageCursorContext(['arg "<env>" {', "}"], "")).toEqual({
			kind: "directive",
		});
		expect(
			getUsageCursorContext(['arg "<env>" { choices "a" "b" }'], ""),
		).toEqual({ kind: "directive" });
	});

	test("inside a quoted string offers nothing", () => {
		expect(getUsageCursorContext([], 'arg "<fi')).toEqual({ kind: "none" });
		expect(getUsageCursorContext([], 'arg "<file>" help="Some ')).toEqual({
			kind: "none",
		});
	});

	test("after a non arg/flag directive offers nothing", () => {
		expect(getUsageCursorContext([], 'choices "a" ')).toEqual({ kind: "none" });
	});
});

describe("getUsageCompletionItems", () => {
	const names = (context: Parameters<typeof getUsageCompletionItems>[0]) =>
		getUsageCompletionItems(context).map((item) => item.name);

	test("directive context offers directives only", () => {
		expect(names({ kind: "directive" })).toEqual(["arg", "flag", "complete"]);
	});

	test("attribute context offers attributes of the directive", () => {
		const argContext: UsageCursorContext = {
			kind: "attribute",
			directive: "arg",
			used: [],
		};
		expect(names(argContext)).toContain("help");
		expect(names(argContext)).not.toContain("count");

		const flagContext: UsageCursorContext = {
			kind: "attribute",
			directive: "flag",
			used: [],
		};
		expect(names(flagContext)).toContain("count");
		expect(names(flagContext)).toContain("negate");

		const completeContext: UsageCursorContext = {
			kind: "attribute",
			directive: "complete",
			used: [],
		};
		expect(names(completeContext)).toEqual(["run", "descriptions"]);
	});

	test("does not offer attributes already used on the line", () => {
		expect(
			names({ kind: "attribute", directive: "flag", used: ["help", "count"] }),
		).not.toContain("help");
		expect(
			names({ kind: "attribute", directive: "flag", used: ["help", "count"] }),
		).not.toContain("count");
		expect(
			names({ kind: "attribute", directive: "flag", used: ["help", "count"] }),
		).toContain("default");
	});

	test("block context offers choices (and arg for flags)", () => {
		expect(names({ kind: "block", directive: "arg", used: [] })).toEqual([
			"choices",
		]);
		expect(names({ kind: "block", directive: "flag", used: [] })).toEqual([
			"choices",
			"arg",
		]);
		expect(
			names({ kind: "block", directive: "arg", used: ["choices"] }),
		).toEqual([]);
	});

	test("none context offers nothing", () => {
		expect(names({ kind: "none" })).toEqual([]);
	});
});

describe("usage hover info", () => {
	test("documents usage directives and attributes", () => {
		expect(getUsageHoverInfo("arg")).toContain("positional argument");
		expect(getUsageHoverInfo("complete")).toContain("custom completion");
		expect(getUsageHoverInfo("count")).toContain("repeated");
		expect(getUsageHoverInfo("choices")).toContain("allowed values");
		expect(getUsageHoverInfo("not_a_keyword")).toBeUndefined();
	});

	test("documents #MISE task configuration keys", () => {
		expect(getFileTaskConfigHoverInfo("description")).toContain("Description");
		expect(getFileTaskConfigHoverInfo("depends")).toContain("before");
		expect(getFileTaskConfigHoverInfo("not_a_key")).toBeUndefined();
	});
});

describe("getUsageVariableNames", () => {
	test("extracts arg and flag variable names", () => {
		expect(
			getUsageVariableNames([
				'arg "<file>" help="File"',
				'arg "[region]" default="us"',
				'flag "-v --verbose"',
				'flag "--format <format>" default="text"',
				'flag "--dry-run"',
				'flag "-x"',
				'  choices "a" "b"',
				"}",
			]),
		).toEqual(["file", "region", "verbose", "format", "dry_run", "x"]);
	});

	test("dedupes repeated names", () => {
		expect(getUsageVariableNames(['arg "<file>"', 'flag "--file"'])).toEqual([
			"file",
		]);
	});
});

describe("getEnclosingTaskUsageLines", () => {
	const doc = (text: string) => text.split("\n");

	test("returns the usage lines of the enclosing task", () => {
		const lines = doc(`[tasks.deploy]
usage = '''
arg "<env>"
flag "--force"
'''
run = '''
echo $usage_
'''`);
		expect(
			getEnclosingTaskUsageLines(lines, { line: 6, character: 12 }),
		).toEqual(['arg "<env>"', 'flag "--force"']);
	});

	test("finds a usage field declared after the run field", () => {
		const lines = doc(`[tasks.deploy]
run = '''
echo $usage_
'''
usage = '''
arg "<env>"
'''`);
		expect(
			getEnclosingTaskUsageLines(lines, { line: 2, character: 12 }),
		).toEqual(['arg "<env>"']);
	});

	test("supports single-line usage strings", () => {
		const lines = doc(`[tasks.deploy]
usage = 'arg "<env>"'
run = '''
echo $usage_
'''`);
		expect(
			getEnclosingTaskUsageLines(lines, { line: 3, character: 12 }),
		).toEqual(['arg "<env>"']);
	});

	test("returns null outside a run block or without a usage field", () => {
		const lines = doc(`[tasks.deploy]
run = '''
echo hi
'''`);
		expect(
			getEnclosingTaskUsageLines(lines, { line: 2, character: 3 }),
		).toBeNull();
		expect(
			getEnclosingTaskUsageLines(lines, { line: 0, character: 0 }),
		).toBeNull();
	});

	test("does not use the usage field of another task", () => {
		const lines = doc(`[tasks.one]
usage = '''
arg "<env>"
'''

[tasks.two]
run = '''
echo $usage_
'''`);
		expect(
			getEnclosingTaskUsageLines(lines, { line: 7, character: 12 }),
		).toBeNull();
	});
});
