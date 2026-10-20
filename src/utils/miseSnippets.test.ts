import { describe, expect, it } from "bun:test";
import { parse } from "toml-v1";
import type * as vscode from "vscode";
import {
	fileTaskSnippets,
	getFileTaskSnippetPosition,
	getTomlSnippetPosition,
	tomlSnippets,
} from "./miseSnippets";

/**
 * The text a snippet inserts when every placeholder keeps its default, and the
 * default of each occurrence of each tab stop. It reads the TextMate grammar
 * as VS Code and Zed do: `\` escapes `$`, `}` and `\`, a `}` outside of a
 * placeholder is plain text, and a choice inserts its first option.
 */
function expandSnippet(body: string) {
	const tabStops = new Map<number, string[]>();
	let position = 0;
	const addTabStop = (index: number, text: string) => {
		tabStops.set(index, [...(tabStops.get(index) ?? []), text]);
		return text;
	};
	const parseText = (inPlaceholder: boolean): string => {
		let text = "";
		while (position < body.length) {
			const rest = body.slice(position);
			const tabStop = rest.match(/^\$(\d+)|^\$\{(\d+)\}/);
			const choice = rest.match(/^\$\{(\d+)\|([^,|]*)[^|]*\|\}/);
			const placeholder = rest.match(/^\$\{(\d+):/);
			if (rest[0] === "\\" && "$}\\".includes(rest[1] ?? "-")) {
				text += rest[1];
				position += 2;
			} else if (rest[0] === "}" && inPlaceholder) {
				position++;
				return text;
			} else if (tabStop) {
				text += addTabStop(Number(tabStop[1] ?? tabStop[2]), "");
				position += tabStop[0].length;
			} else if (choice) {
				text += addTabStop(Number(choice[1]), choice[2] ?? "");
				position += choice[0].length;
			} else if (placeholder) {
				position += placeholder[0].length;
				text += addTabStop(Number(placeholder[1]), parseText(true));
			} else {
				text += rest[0];
				position++;
			}
		}
		if (inPlaceholder) {
			throw new Error(`a placeholder is not closed in:\n${body}`);
		}
		return text;
	};
	return { text: parseText(false), tabStops };
}

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
	it("are all under the mise- prefix", () => {
		for (const snippet of [...tomlSnippets, ...fileTaskSnippets]) {
			expect(snippet.prefix).toMatch(/^mise-(task|daemon)(-[a-z]+)*$/);
		}
	});

	// mise-zed copies these snippets, and Zed does not copy a placeholder's
	// default to the other occurrences of its tab stop as VS Code does
	it("give the same default to every occurrence of a tab stop", () => {
		for (const snippet of [...tomlSnippets, ...fileTaskSnippets]) {
			for (const [index, defaults] of expandSnippet(snippet.body).tabStops) {
				expect({ prefix: snippet.prefix, index, defaults }).toEqual({
					prefix: snippet.prefix,
					index,
					defaults: defaults.map(() => defaults[0] ?? ""),
				});
			}
		}
	});

	// an unescaped } in a default closes its placeholder early
	it("have placeholder defaults with balanced braces", () => {
		for (const snippet of [...tomlSnippets, ...fileTaskSnippets]) {
			for (const [index, defaults] of expandSnippet(snippet.body).tabStops) {
				for (const text of defaults) {
					const opened = text.split("{").length;
					const closed = text.split("}").length;
					expect({ prefix: snippet.prefix, index, text, closed }).toEqual({
						prefix: snippet.prefix,
						index,
						text,
						closed: opened,
					});
				}
			}
		}
	});

	it("insert valid toml with their defaults", () => {
		for (const snippet of tomlSnippets) {
			const { text } = expandSnippet(snippet.body);
			let error: string | undefined;
			try {
				parse(text);
			} catch (e) {
				error = `${e}\n${text}`;
			}
			expect({ prefix: snippet.prefix, error }).toEqual({
				prefix: snippet.prefix,
				error: undefined,
			});
		}
	});

	it("list the daemon snippets after the task ones", () => {
		const prefixes = tomlSnippets.map((snippet) => snippet.prefix);
		const firstDaemon = prefixes.indexOf("mise-daemon");
		expect(prefixes.slice(firstDaemon)).toEqual([
			"mise-daemon",
			"mise-daemon-preset",
			"mise-daemon-task",
			"mise-daemon-auto",
			"mise-daemon-groups",
		]);
		expect(
			prefixes
				.slice(0, firstDaemon)
				.every((prefix) => prefix.startsWith("mise-task")),
		).toBe(true);
		// the order the suggest widget shows them in
		const sortTexts = tomlSnippets.map((snippet) => snippet.sortText);
		expect(sortTexts).toEqual([...sortTexts].sort());
		// a daemon declares a table, as a task does
		for (const snippet of tomlSnippets.slice(firstDaemon)) {
			expect(snippet.body).toMatch(/^\[daemon(s|_groups)/);
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
