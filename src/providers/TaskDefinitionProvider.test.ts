import { describe, expect, it } from "bun:test";
import * as vscode from "vscode";
import type { MiseService } from "../miseService";
import { TaskDefinitionProvider } from "./TaskDefinitionProvider";

let documentVersion = 0;

/** Enough of a `TextDocument` for the provider to find the word at a position */
function fakeDocument(path: string, content: string): vscode.TextDocument {
	const lines = content.split("\n");

	return {
		fileName: path,
		version: documentVersion++,
		uri: vscode.Uri.file(path),
		lineCount: lines.length,
		getText: () => content,
		lineAt: (lineOrPosition: number | vscode.Position) => {
			const line =
				typeof lineOrPosition === "number"
					? lineOrPosition
					: lineOrPosition.line;
			const text = lines[line] ?? "";
			return {
				text,
				range: new vscode.Range(
					new vscode.Position(line, 0),
					new vscode.Position(line, text.length),
				),
			};
		},
		getWordRangeAtPosition: (position: vscode.Position, regex: RegExp) => {
			const text = lines[position.line] ?? "";
			for (const match of text.matchAll(new RegExp(regex.source, "g"))) {
				const start = match.index;
				const end = start + match[0].length;
				if (start <= position.character && position.character <= end) {
					return new vscode.Range(
						new vscode.Position(position.line, start),
						new vscode.Position(position.line, end),
					);
				}
			}
			return undefined;
		},
	} as unknown as vscode.TextDocument;
}

function createProvider({
	configFiles,
	tasks,
}: {
	configFiles: string[];
	tasks: { name: string; source: string }[];
}) {
	const miseService = {
		getAllCachedTasks: async () =>
			tasks.map((task) => ({ ...task, aliases: [] })),
		getMiseConfigFiles: async () =>
			configFiles.map((path) => ({ path, tools: [] })),
	} as unknown as MiseService;

	return new TaskDefinitionProvider(miseService);
}

describe("TaskDefinitionProvider", () => {
	it("treats a top-level key of a task file as a task", async () => {
		const provider = createProvider({
			configFiles: ["/project/mise.toml"],
			tasks: [{ name: "build", source: "/project/tasks.toml" }],
		});
		const document = fakeDocument(
			"/project/tasks.toml",
			'build = "echo build"\n',
		);

		const definition = await provider.provideDefinition(
			document,
			new vscode.Position(0, 2),
		);

		expect(definition).toHaveLength(1);
	});

	// https://github.com/hverlin/mise-vscode/issues/310
	it("does not treat a top-level key of a config file as a task", async () => {
		const path = "/project/.config/mise/config.local.toml";
		const provider = createProvider({
			configFiles: [path],
			tasks: [{ name: "settings", source: path }],
		});
		const document = fakeDocument(
			path,
			`[settings]
experimental = true

[tasks.settings]
run = "echo settings"
`,
		);

		const definition = await provider.provideDefinition(
			document,
			new vscode.Position(0, 2),
		);

		expect(definition).toBeNull();
	});
});
