import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Verifies that `[monorepo] config_roots` entries auto-complete workspace
 * directories, one path segment at a time, plus a `*` glob entry.
 */
suite("Monorepo Config Roots Completion Test Suite", function () {
	this.timeout(30_000);

	let document: vscode.TextDocument;

	const lineOf = (text: string): number => {
		for (let i = 0; i < document.lineCount; i++) {
			if (document.lineAt(i).text.includes(text)) {
				return i;
			}
		}
		assert.fail(`Line containing "${text}" not found in fixture`);
	};

	// directory completions come only from the config_roots provider
	const getFolderCompletionLabels = async (
		position: vscode.Position,
	): Promise<string[]> => {
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				document.uri,
				position,
			);
		return completions.items
			.filter((item) => item.kind === vscode.CompletionItemKind.Folder)
			.map((item) =>
				typeof item.label === "string" ? item.label : item.label.label,
			);
	};

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);
	});

	test("completes top-level directories at the start of an entry", async () => {
		const line = lineOf('"crates/*"');
		const character = document.lineAt(line).text.indexOf('"crates') + 1;
		const labels = await getFolderCompletionLabels(
			new vscode.Position(line, character),
		);

		for (const expected of ["projects", "crates", "go", "python"]) {
			assert.ok(labels.includes(expected), `Expected ${expected} in ${labels}`);
		}
	});

	test("completes subdirectories and a glob after a path segment", async () => {
		const line = lineOf('"projects/*"');
		const lineText = document.lineAt(line).text;
		const character = lineText.indexOf("projects/*") + "projects/".length;
		const labels = await getFolderCompletionLabels(
			new vscode.Position(line, character),
		);

		for (const expected of ["frontend", "backend", "shared", "*"]) {
			assert.ok(labels.includes(expected), `Expected ${expected} in ${labels}`);
		}
		assert.ok(
			!labels.includes("projects"),
			"Should list the subdirectories, not the top level",
		);
	});

	test("replaces a bare token typed without quotes", async () => {
		const editor = await vscode.window.showTextDocument(document);
		const anchorLine = lineOf('"go/*"');
		const insertPosition = new vscode.Position(
			anchorLine,
			document.lineAt(anchorLine).text.length,
		);
		await editor.edit((edit) => {
			edit.insert(insertPosition, "\n\tpro");
		});

		try {
			const completions =
				await vscode.commands.executeCommand<vscode.CompletionList>(
					"vscode.executeCompletionItemProvider",
					document.uri,
					new vscode.Position(anchorLine + 1, 4),
				);
			const projects = completions.items.find(
				(item) =>
					item.kind === vscode.CompletionItemKind.Folder &&
					item.label === "projects",
			);
			assert.ok(projects, "Expected a completion for projects");
			assert.equal(projects.insertText, '"projects"');

			// the replace range covers the bare token so accepting the
			// completion yields "projects", not pro"projects"
			const range =
				projects.range instanceof vscode.Range
					? projects.range
					: projects.range?.replacing;
			assert.ok(range, "Expected a replace range");
			assert.equal(document.getText(range), "pro");
		} finally {
			await vscode.commands.executeCommand("workbench.action.files.revert");
		}
	});

	test("does not complete directories in other arrays", async () => {
		const line = lineOf('"//projects/...:build"');
		const character = document.lineAt(line).text.indexOf("//projects") + 2;
		const labels = await getFolderCompletionLabels(
			new vscode.Position(line, character),
		);
		assert.deepEqual(labels, []);
	});
});
