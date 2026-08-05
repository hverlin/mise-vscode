import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import {
	fileTaskSnippets,
	type MiseSnippet,
	tomlSnippets,
} from "../utils/miseSnippets";

/**
 * Task snippets are provided by the extension rather than contributed to the
 * `toml`/`shellscript` languages, so they only show up in the files mise loads,
 * and only where a task can actually be inserted.
 */
suite("Snippets Test Suite", function () {
	this.timeout(30_000);

	const prefixesOf = (snippets: MiseSnippet[]) =>
		snippets.map((snippet) => snippet.prefix).sort();

	let workspaceRoot: string;

	suiteSetup(() => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(root, "Workspace root should be available");
		workspaceRoot = root;
	});

	const openFixture = (fileName: string) =>
		vscode.workspace.openTextDocument(path.join(workspaceRoot, fileName));

	const lineOf = (document: vscode.TextDocument, text: string): number => {
		for (let i = 0; i < document.lineCount; i++) {
			if (document.lineAt(i).text.includes(text)) {
				return i;
			}
		}
		assert.fail(`Line containing "${text}" not found in ${document.fileName}`);
	};

	/** The empty line following the one containing `marker` */
	const emptyLineAfter = (
		document: vscode.TextDocument,
		marker: string,
	): vscode.Position => {
		const line = lineOf(document, marker) + 1;
		assert.equal(
			document.lineAt(line).text.trim(),
			"",
			`the line after "${marker}" should be empty in the fixture`,
		);
		return new vscode.Position(line, 0);
	};

	/**
	 * The trailing empty line of the document, where a snippet can be inserted
	 * as far as the position goes: what the negative cases are left with is the
	 * file itself.
	 */
	const endOfDocument = (document: vscode.TextDocument): vscode.Position => {
		const line = document.lineCount - 1;
		assert.equal(
			document.lineAt(line).text.trim(),
			"",
			`${document.fileName} should end with an empty line`,
		);
		return new vscode.Position(line, 0);
	};

	const snippetLabels = async (
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<string[]> => {
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				document.uri,
				position,
			);
		return (
			completions.items
				.filter((item) => item.kind === vscode.CompletionItemKind.Snippet)
				.map((item) =>
					typeof item.label === "string" ? item.label : item.label.label,
				)
				// the namespace of the extension, other providers contribute here too
				.filter((label) => label.startsWith("mise-task"))
				.sort()
		);
	};

	test("offers task snippets on an empty line of a mise config file", async () => {
		const document = await openFixture("mise.snippets.toml");
		const labels = await snippetLabels(document, endOfDocument(document));
		assert.deepEqual(labels, prefixesOf(tomlSnippets));
	});

	test("does not offer task snippets inside a multiline string", async () => {
		const document = await openFixture("mise.snippets.toml");
		const labels = await snippetLabels(
			document,
			emptyLineAfter(document, "inside a multiline string"),
		);
		assert.deepEqual(labels, []);
	});

	test("does not offer task snippets inside an array", async () => {
		const document = await openFixture("mise.snippets.toml");
		const labels = await snippetLabels(
			document,
			emptyLineAfter(document, '"echo-hello",'),
		);
		assert.deepEqual(labels, []);
	});

	test("does not offer task snippets in a toml file mise does not load", async () => {
		const document = await openFixture("task-references.toml");
		const labels = await snippetLabels(document, endOfDocument(document));
		assert.deepEqual(labels, []);
	});

	test("offers file task snippets in the header of a file task", async () => {
		const document = await openFixture("mise-tasks/new-task.sh");
		const labels = await snippetLabels(
			document,
			emptyLineAfter(document, "#!/usr/bin/env bash"),
		);
		assert.deepEqual(labels, prefixesOf(fileTaskSnippets));
	});

	test("does not offer file task snippets in the body of a file task", async () => {
		const document = await openFixture("mise-tasks/new-task.sh");
		const labels = await snippetLabels(document, endOfDocument(document));
		assert.deepEqual(labels, []);
	});

	test("does not offer file task snippets in a script that is not a task", async () => {
		const document = await openFixture("not-a-task.sh");
		const labels = await snippetLabels(
			document,
			emptyLineAfter(document, "#!/usr/bin/env bash"),
		);
		assert.deepEqual(labels, []);
	});

	test("offers no snippets when they are turned off", async () => {
		const config = vscode.workspace.getConfiguration("mise");
		await config.update(
			"enableSnippets",
			false,
			vscode.ConfigurationTarget.Global,
		);
		try {
			const document = await openFixture("mise.snippets.toml");
			const labels = await snippetLabels(document, endOfDocument(document));
			assert.deepEqual(labels, []);
		} finally {
			await config.update(
				"enableSnippets",
				undefined,
				vscode.ConfigurationTarget.Global,
			);
		}
	});
});
