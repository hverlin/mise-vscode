import { describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import {
	getInitializationOptions,
	isOn,
	isTaskOrToolCompletion,
	isTaskOrToolHover,
	sameDiagnostics,
	splitDiagnostics,
} from "./languageServer";

const range = (
	startLine: number,
	startCharacter: number,
	endLine: number,
	endCharacter: number,
) =>
	({
		start: { line: startLine, character: startCharacter },
		end: { line: endLine, character: endCharacter },
	}) as vscode.Range;

const diagnostic = (
	overrides: Partial<vscode.Diagnostic> & { range: vscode.Range },
) =>
	({ message: "problem", source: "mise", ...overrides }) as vscode.Diagnostic;

const markdown = (value: string) => ({ value }) as vscode.MarkdownString;

describe("getInitializationOptions", () => {
	it("leaves definitions, references and semantic tokens to the extension", () => {
		expect(getInitializationOptions(false)).toEqual({
			definition: false,
			references: false,
			semanticTokens: false,
		});
	});

	it("leaves the keys to a TOML extension", () => {
		expect(getInitializationOptions(true)).toEqual({
			definition: false,
			references: false,
			semanticTokens: false,
			completion: false,
			hover: false,
			formatting: false,
		});
	});
});

// as `mise lsp` 2026.10.19 answers
describe("isTaskOrToolHover", () => {
	it("matches the hovers of tasks, templates and tools", () => {
		for (const value of [
			"**lint** _task_\n\n```sh\necho lint\n```",
			"**base** _task template_\n\n```sh\necho base\n```",
			"**node** _tool_\n\nNode.js\n\nBackends: `core:node`",
		]) {
			expect(
				isTaskOrToolHover({ contents: [markdown(value)] } as vscode.Hover),
			).toBe(true);
		}
	});

	it("keeps the hovers of keys", () => {
		expect(
			isTaskOrToolHover({
				contents: [
					markdown(
						"**tasks.build.description** _string_\n\ndescription of task",
					),
				],
			} as vscode.Hover),
		).toBe(false);
	});
});

describe("isTaskOrToolCompletion", () => {
	it("matches task, template and tool names", () => {
		// the detail of a task or template is its description when it has one
		const items = [
			{
				label: "lint",
				kind: vscode.CompletionItemKind.Function,
				detail: "task",
			},
			{
				label: "build",
				kind: vscode.CompletionItemKind.Function,
				detail: "Build it",
				documentation: markdown("Build it\n\n```sh\necho build\n```"),
			},
			{
				label: "base",
				kind: vscode.CompletionItemKind.Function,
				detail: "task template",
			},
			{
				label: "1password",
				detail: "Password manager developed by AgileBits Inc",
				documentation: markdown(
					"**1password** _tool_\n\nPassword manager developed by AgileBits Inc",
				),
			},
		] as vscode.CompletionItem[];
		expect(items.map(isTaskOrToolCompletion)).toEqual([true, true, true, true]);
	});

	it("keeps keys", () => {
		expect(
			isTaskOrToolCompletion({
				label: "description",
				detail: "description of task",
				documentation: markdown("description of task"),
			} as vscode.CompletionItem),
		).toBe(false);
	});
});

describe("splitDiagnostics", () => {
	const unknownKey = diagnostic({
		range: range(3, 0, 3, 10),
		code: "unknown-key",
	});
	const unknownTask = diagnostic({
		range: range(2, 12, 2, 16),
		code: "unknown-task",
	});
	const syntax = diagnostic({ range: range(5, 2, 5, 2), code: "syntax" });

	it("shows everything when nothing else reports it", () => {
		expect(splitDiagnostics([unknownKey, unknownTask, syntax], [])).toEqual({
			shown: [unknownKey, unknownTask, syntax],
			hidden: [],
		});
	});

	it("hides what Tombi or Even Better TOML report on the same range", () => {
		const others = [
			diagnostic({ range: range(3, 0, 3, 10), source: "Tombi" }),
			diagnostic({ range: range(5, 2, 5, 2), source: "Even Better TOML" }),
			// another source on the same range, e.g. this extension
			diagnostic({ range: range(2, 12, 2, 16), source: "mise" }),
		];
		expect(splitDiagnostics([unknownKey, unknownTask, syntax], others)).toEqual(
			{ shown: [unknownTask], hidden: [unknownKey, syntax] },
		);
	});

	it("does not hide a problem next to another one", () => {
		const others = [
			diagnostic({ range: range(3, 10, 3, 12), source: "Tombi" }),
		];
		expect(splitDiagnostics([unknownKey], others).shown).toEqual([unknownKey]);
	});

	// as TaskValidationDiagnostics reports them, from `mise tasks validate`
	const validated = (code: string, at: vscode.Range) =>
		diagnostic({ range: at, code, source: "mise" });
	const cycle = diagnostic({
		range: range(7, 11, 7, 12),
		code: { value: "task-cycle", target: {} as vscode.Uri },
	});

	it("hides an unknown task mise tasks validate reports on the same range", () => {
		// the quoted name
		const others = [validated("missing-dependency", range(2, 11, 2, 17))];
		expect(splitDiagnostics([unknownKey, unknownTask], others)).toEqual({
			shown: [unknownKey],
			hidden: [unknownTask],
		});
	});

	it("shows an unknown task mise tasks validate does not report", () => {
		// e.g. a template of `extends`: mise tasks validate cannot load the config
		const others = [validated("missing-dependency", range(9, 11, 9, 17))];
		expect(splitDiagnostics([unknownTask], others).shown).toEqual([
			unknownTask,
		]);
	});

	it("hides a cycle mise tasks validate reports on one of its tasks", () => {
		const header = range(4, 0, 4, 9);
		expect(
			splitDiagnostics([cycle], [validated("circular-dependency", header)]),
		).toEqual({ shown: [], hidden: [cycle] });
		expect(splitDiagnostics([cycle], []).shown).toEqual([cycle]);
	});

	it("does not take its own diagnostics for those of mise tasks validate", () => {
		expect(
			splitDiagnostics([unknownTask, cycle], [unknownTask, cycle]),
		).toEqual({ shown: [unknownTask, cycle], hidden: [] });
	});
});

describe("sameDiagnostics", () => {
	it("compares messages and ranges", () => {
		const a = diagnostic({ range: range(1, 0, 1, 3) });
		expect(
			sameDiagnostics([a], [diagnostic({ range: range(1, 0, 1, 3) })]),
		).toBe(true);
		expect(
			sameDiagnostics([a], [diagnostic({ range: range(1, 0, 1, 4) })]),
		).toBe(false);
		expect(
			sameDiagnostics(
				[a],
				[diagnostic({ range: range(1, 0, 1, 3), message: "other" })],
			),
		).toBe(false);
		expect(sameDiagnostics([a], [])).toBe(false);
	});
});

describe("isOn", () => {
	const problem = diagnostic({ range: range(3, 4, 3, 10) });

	it("matches a range on or touching the diagnostic", () => {
		expect(isOn(problem, range(3, 5, 3, 5))).toBe(true);
		expect(isOn(problem, range(3, 10, 3, 10))).toBe(true);
		expect(isOn(problem, range(3, 0, 3, 4))).toBe(true);
	});

	it("skips a range elsewhere", () => {
		expect(isOn(problem, range(3, 11, 3, 12))).toBe(false);
		expect(isOn(problem, range(4, 4, 4, 10))).toBe(false);
	});
});
