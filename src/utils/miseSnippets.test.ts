import { describe, expect, it } from "bun:test";
import type * as vscode from "vscode";
import {
	fileTaskSnippets,
	getFileTaskSnippetPosition,
	getTomlSnippetPosition,
	tomlSnippets,
} from "./miseSnippets";

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

/**
 * Position of the `|` marker in `content`, which is removed before the document
 * is built.
 */
function documentWithCursor(content: string) {
	const offset = content.indexOf("|");
	if (offset === -1) {
		throw new Error("the content needs a | cursor marker");
	}
	const before = content.slice(0, offset);
	const line = before.split("\n").length - 1;
	const character = before.length - (before.lastIndexOf("\n") + 1);
	return {
		document: fakeDocument(content.replace("|", "")),
		position: { line, character } as vscode.Position,
	};
}

const tomlPositionOf = (content: string) => {
	const { document, position } = documentWithCursor(content);
	return getTomlSnippetPosition(document, position);
};

const fileTaskPositionOf = (content: string) => {
	const { document, position } = documentWithCursor(content);
	return getFileTaskSnippetPosition(document, position);
};

describe("snippet definitions", () => {
	it("are loaded with their prefix and a body", () => {
		expect(tomlSnippets[0]?.prefix).toBe("mise-task");
		expect(fileTaskSnippets[0]?.prefix).toBe("mise-task");

		for (const snippet of [...tomlSnippets, ...fileTaskSnippets]) {
			expect(snippet.description).not.toBe("");
			expect(snippet.body).toContain("\n");
		}
	});

	// they share a namespace so that one prefix brings up everything the
	// extension offers, and none of them competes with a toml schema key
	it("are all under the mise-task prefix", () => {
		for (const snippet of [...tomlSnippets, ...fileTaskSnippets]) {
			expect(snippet.prefix).toMatch(/^mise-task(-[a-z]+)*$/);
		}
	});
});

describe("getTomlSnippetPosition", () => {
	it("offers snippets on an empty line", () => {
		expect(tomlPositionOf('[tasks.a]\nrun = "echo"\n\n|')).toEqual({
			replaceStart: 0,
		});
	});

	it("replaces the word being typed", () => {
		expect(tomlPositionOf("[tasks.a]\nrun = 'echo'\n\ntas|")).toEqual({
			replaceStart: 0,
		});
		// the prefixes are hyphenated, the dash is part of the word
		expect(tomlPositionOf("[tasks.a]\nrun = 'echo'\n\nmise-task-|")).toEqual({
			replaceStart: 0,
		});
	});

	it("replaces an opening bracket, so [tas does not become [[tasks", () => {
		expect(tomlPositionOf("[tas|")).toEqual({ replaceStart: 0 });
		expect(tomlPositionOf("  [|")).toEqual({ replaceStart: 2 });
	});

	it("does not offer snippets in the middle of a line", () => {
		expect(tomlPositionOf('run = "echo tas|"')).toBeUndefined();
		expect(tomlPositionOf("depends = [tas|]")).toBeUndefined();
		expect(tomlPositionOf("tas| = 1")).toBeUndefined();
		expect(tomlPositionOf("[tasks.a]\nrun| = 1")).toBeUndefined();
	});

	it("does not offer snippets inside a multiline string", () => {
		expect(tomlPositionOf("[tasks.a]\nrun = '''\ntas|\n'''")).toBeUndefined();
		expect(tomlPositionOf('[tasks.a]\nrun = """\n|\n"""')).toBeUndefined();
		expect(
			tomlPositionOf('[tasks.a]\nusage = """\narg "<file>"\n|\n"""'),
		).toBeUndefined();
	});

	it("offers snippets again after a multiline string is closed", () => {
		expect(tomlPositionOf("[tasks.a]\nrun = '''\necho hi\n'''\n\n|")).toEqual({
			replaceStart: 0,
		});
		// an escaped quote does not close a basic string
		expect(
			tomlPositionOf('[tasks.a]\nrun = """\necho \\"""hi\n"""\n\n|'),
		).toEqual({ replaceStart: 0 });
	});

	it("does not offer snippets inside a multiline array or inline table", () => {
		expect(
			tomlPositionOf('[tasks.a]\ndepends = [\n  "build",\n  |\n]'),
		).toBeUndefined();
		expect(
			tomlPositionOf("[tasks.a]\nenv = {\n  KEY = 1,\n  |\n}"),
		).toBeUndefined();
	});

	it("is not confused by brackets and hashes inside strings", () => {
		expect(tomlPositionOf('[tasks.a]\nrun = "echo [ { #"\n\n|')).toEqual({
			replaceStart: 0,
		});
		expect(tomlPositionOf("[tasks.a] # a [ comment\n|")).toEqual({
			replaceStart: 0,
		});
	});

	it("does not offer snippets in a comment", () => {
		expect(tomlPositionOf("# tas|")).toBeUndefined();
	});
});

describe("getFileTaskSnippetPosition", () => {
	it("offers snippets in the header comment block", () => {
		expect(fileTaskPositionOf("#!/usr/bin/env bash\n|")).toEqual({
			replaceStart: 0,
		});
		expect(
			fileTaskPositionOf('#!/usr/bin/env bash\n#MISE description="x"\nmise|'),
		).toEqual({ replaceStart: 0 });
	});

	it("replaces a leading hash", () => {
		expect(fileTaskPositionOf("#!/usr/bin/env bash\n#mise|")).toEqual({
			replaceStart: 0,
		});
	});

	it("does not offer snippets once the script body started", () => {
		expect(
			fileTaskPositionOf("#!/usr/bin/env bash\necho hi\n\n|"),
		).toBeUndefined();
	});

	it("does not offer snippets in the middle of a line", () => {
		expect(
			fileTaskPositionOf('#!/usr/bin/env bash\nmise| "x"'),
		).toBeUndefined();
	});

	it("does not offer snippets while the shebang is being typed", () => {
		expect(fileTaskPositionOf("#!|")).toBeUndefined();
	});
});
