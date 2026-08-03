import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import {
	findTaskTemplatesInDocument,
	findTaskTemplateUsagesInDocument,
	formatTaskTemplateDetail,
	formatTaskTemplateMarkdown,
	isTaskExtendsKeyPath,
	isTaskTemplateKeyPath,
} from "./taskTemplates";

let documentCounter = 0;

/** Enough of a `TextDocument` for the range arithmetic of the module */
function fakeDocument(content: string, fileName?: string): vscode.TextDocument {
	const path = fileName ?? `/workspace/mise-${documentCounter++}.toml`;
	const lines = content.split("\n");

	return {
		fileName: path,
		version: 1,
		uri: { fsPath: path, toString: () => `file://${path}` },
		lineCount: lines.length,
		getText: (range?: vscode.Range) => {
			if (!range) {
				return content;
			}
			if (range.start.line !== range.end.line) {
				return content;
			}
			return (lines[range.start.line] ?? "").slice(
				range.start.character,
				range.end.character,
			);
		},
		lineAt: (lineOrPosition: number | vscode.Position) => {
			const line =
				typeof lineOrPosition === "number"
					? lineOrPosition
					: lineOrPosition.line;
			const text = lines[line] ?? "";
			return {
				text,
				range: {
					start: { line, character: 0 },
					end: { line, character: text.length },
				},
			};
		},
	} as unknown as vscode.TextDocument;
}

const positionOf = (position?: vscode.Position) =>
	position && [position.line, position.character];

describe("isTaskExtendsKeyPath", () => {
	it("matches the extends key of a task", () => {
		expect(isTaskExtendsKeyPath(["tasks", "build", "extends"])).toBe(true);
	});

	it("ignores extends keys of other sections", () => {
		expect(isTaskExtendsKeyPath(["task_templates", "base", "extends"])).toBe(
			false,
		);
		expect(isTaskExtendsKeyPath(["tools", "node", "extends"])).toBe(false);
		expect(isTaskExtendsKeyPath(["tasks", "build", "cache", "extends"])).toBe(
			false,
		);
	});
});

describe("isTaskTemplateKeyPath", () => {
	it("matches a task template name", () => {
		expect(isTaskTemplateKeyPath(["task_templates", "python:build"])).toBe(
			true,
		);
	});

	it("ignores the section itself and its fields", () => {
		expect(isTaskTemplateKeyPath(["task_templates"])).toBe(false);
		expect(isTaskTemplateKeyPath(["task_templates", "base", "run"])).toBe(
			false,
		);
		expect(isTaskTemplateKeyPath(["tasks", "build"])).toBe(false);
	});
});

describe("findTaskTemplatesInDocument", () => {
	it("finds section templates with their fields and ranges", () => {
		const document = fakeDocument(
			[
				'[task_templates."python:build"]',
				'description = "Build a python package"',
				'run = "uv build"',
				'tools = { python = "3.12" }',
				"",
				"[tasks.build]",
				'extends = "python:build"',
			].join("\n"),
		);

		const templates = findTaskTemplatesInDocument(document);
		expect(templates.length).toBe(1);

		const template = templates[0];
		expect(template?.name).toBe("python:build");
		expect(template?.fields).toEqual({
			description: "Build a python package",
			run: "uv build",
			tools: { python: "3.12" },
		});
		// the quotes of the section header are not part of the name
		expect(positionOf(template?.nameRange.start)).toEqual([0, 17]);
		expect(positionOf(template?.nameRange.end)).toEqual([0, 29]);
		// the body stops before the next section
		expect(template?.bodyRange.start.line).toBe(0);
		expect(template?.bodyRange.end.line).toBe(3);
	});

	it("supports the inline and shorthand forms", () => {
		const document = fakeDocument(
			[
				"[task_templates]",
				'lint = { run = "eslint ." }',
				'greet = "echo hello"',
			].join("\n"),
		);

		const templates = findTaskTemplatesInDocument(document);
		expect(templates.map((template) => template.name)).toEqual([
			"lint",
			"greet",
		]);
		expect(templates[0]?.fields).toEqual({ run: "eslint ." });
		// a bare string template only declares a command
		expect(templates[1]?.fields).toEqual({ run: "echo hello" });
	});

	it("returns nothing without a task_templates section", () => {
		expect(
			findTaskTemplatesInDocument(
				fakeDocument('[tasks.build]\nrun = "echo hi"'),
			),
		).toEqual([]);
	});
});

describe("findTaskTemplateUsagesInDocument", () => {
	it("finds the extends of section and inline tasks", () => {
		const document = fakeDocument(
			[
				"[tasks.build]",
				'extends = "python:build"',
				"",
				"[tasks]",
				'test = { extends = "python:test" }',
			].join("\n"),
		);

		const usages = findTaskTemplateUsagesInDocument(document);
		expect(usages.map((usage) => [usage.taskName, usage.templateName])).toEqual(
			[
				["build", "python:build"],
				["test", "python:test"],
			],
		);
		// the range covers the name only, not the quotes around it
		expect(positionOf(usages[0]?.nameRange.start)).toEqual([1, 11]);
		expect(positionOf(usages[0]?.nameRange.end)).toEqual([1, 23]);
	});

	it("filters on a template name", () => {
		const document = fakeDocument(
			[
				"[tasks.build]",
				'extends = "base"',
				"[tasks.test]",
				'extends = "other"',
			].join("\n"),
		);

		expect(
			findTaskTemplateUsagesInDocument(document, "base").map(
				(usage) => usage.taskName,
			),
		).toEqual(["build"]);
	});

	it("ignores the extends of sections that are not tasks", () => {
		const document = fakeDocument(
			['[task_templates.base]\nextends = "other"'].join("\n"),
		);
		expect(findTaskTemplateUsagesInDocument(document)).toEqual([]);
	});
});

describe("formatTaskTemplateMarkdown", () => {
	it("renders the description, the command and the remaining fields", () => {
		const document = fakeDocument(
			[
				"[task_templates.build]",
				'description = "Build it"',
				'run = "uv build"',
				'depends = ["setup"]',
				'tools = { python = "3.12" }',
			].join("\n"),
		);
		const template = findTaskTemplatesInDocument(document)[0];
		expect(template).toBeDefined();
		if (!template) {
			return;
		}

		const markdown = formatTaskTemplateMarkdown(template).value;
		expect(markdown).toContain("**build** (task template)");
		expect(markdown).toContain("Build it");
		expect(markdown).toContain("uv build");
		expect(markdown).toContain('depends = ["setup"]');
		expect(markdown).toContain('tools = { python = "3.12" }');
	});

	it("summarises a template in one line", () => {
		const withDescription = findTaskTemplatesInDocument(
			fakeDocument('[task_templates.a]\ndescription = "Docs"\nrun = "x"'),
		)[0];
		const withoutDescription = findTaskTemplatesInDocument(
			fakeDocument('[task_templates.b]\nrun = ["first", "second"]'),
		)[0];

		expect(withDescription && formatTaskTemplateDetail(withDescription)).toBe(
			"Docs",
		);
		expect(
			withoutDescription && formatTaskTemplateDetail(withoutDescription),
		).toBe("first");
	});
});
