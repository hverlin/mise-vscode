import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import {
	findTaskTemplatesInDocument,
	findTaskTemplateUsagesInDocument,
	formatTaskTemplateDetail,
	formatTaskTemplateMarkdown,
	isMiseConfigFile,
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
		expect(template?.headerRange.start.line).toBe(0);
		// the text stops before the next section
		expect(template?.text).toBe(
			[
				'description = "Build a python package"',
				'run = "uv build"',
				'tools = { python = "3.12" }',
			].join("\n"),
		);
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
		expect(templates[0]?.text).toBe('lint = { run = "eslint ." }');
		// a bare string template only declares a command
		expect(templates[1]?.fields).toEqual({ run: "echo hello" });
		expect(templates[1]?.headerRange.start.line).toBe(2);
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
	it("renders the template as written", () => {
		const body = [
			'description = "Build it"',
			'run = "uv build"',
			"usage = '''",
			'flag "--target <target>" help="Where to build"',
			"'''",
			'tools = { python = "3.12" }',
		].join("\n");
		const template = findTaskTemplatesInDocument(
			fakeDocument(`[task_templates.build]\n${body}`),
		)[0];
		expect(template).toBeDefined();
		if (!template) {
			return;
		}

		const markdown = formatTaskTemplateMarkdown(template).value;
		expect(markdown).toContain("**build** (task template)");
		// no escaped quotes or newlines, as when the fields were serialized again
		expect(markdown).toContain(body);
		expect(
			formatTaskTemplateMarkdown(template, { header: false }).value,
		).not.toContain("task template");
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

describe("isMiseConfigFile", () => {
	const listing = (paths: string[]) => ({
		getMiseConfigFiles: async () => paths.map((path) => ({ path })),
	});
	const failing = {
		getMiseConfigFiles: async (): Promise<{ path: string }[]> => {
			throw new Error("error parsing config file");
		},
	};

	it("recognizes config file names without asking mise", async () => {
		// `mise config ls` does not list the config files of monorepo subprojects
		for (const path of [
			"/home/me/project/projects/frontend/mise.toml",
			"/home/me/.config/mise/conf.d/tools.toml",
			"/home/me/project/.config/mise/config.local.toml",
		]) {
			expect(await isMiseConfigFile(failing, path)).toBe(true);
		}
	});

	it("asks mise about other file names", async () => {
		const custom = "/home/me/dotfiles/mise-global.toml";
		expect(await isMiseConfigFile(listing([custom]), custom)).toBe(true);
		expect(
			await isMiseConfigFile(listing([custom]), "/home/me/project/tasks.toml"),
		).toBe(false);
	});

	it("is not a config file when mise cannot answer", async () => {
		expect(await isMiseConfigFile(failing, "/home/me/project/tasks.toml")).toBe(
			false,
		);
	});
});
