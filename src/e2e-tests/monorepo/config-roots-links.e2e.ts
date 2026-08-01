import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Verifies that literal `[monorepo] config_roots` entries link to the
 * sub-project config, while glob entries are left alone.
 */
suite("Monorepo Config Roots Links Test Suite", function () {
	this.timeout(30_000);

	let document: vscode.TextDocument;
	let links: vscode.DocumentLink[];

	const lineOf = (text: string): number => {
		for (let i = 0; i < document.lineCount; i++) {
			if (document.lineAt(i).text.includes(text)) {
				return i;
			}
		}
		assert.fail(`Line containing "${text}" not found in fixture`);
	};

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		links =
			(await vscode.commands.executeCommand<vscode.DocumentLink[]>(
				"vscode.executeLinkProvider",
				document.uri,
			)) ?? [];
	});

	test("links literal config_roots entries to the project config", () => {
		const link = links.find((l) =>
			l.target?.toString().endsWith("projects/backend/integration/mise.toml"),
		);
		assert.ok(link, "Expected a link for projects/backend/integration");

		const configRootLine = lineOf('"projects/backend/integration"');
		assert.equal(link.range.start.line, configRootLine);
		// range covers the path inside the quotes
		const lineText = document.lineAt(configRootLine).text;
		assert.equal(
			lineText.slice(link.range.start.character, link.range.end.character),
			"projects/backend/integration",
		);
	});

	test("does not link glob config_roots entries", () => {
		const globLine = lineOf('"projects/*"');
		const globStart = document.lineAt(globLine).text.indexOf("projects/*");
		const globLinks = links.filter(
			(l) =>
				l.range.start.line === globLine &&
				l.range.start.character >= globStart - 1 &&
				l.range.start.character <= globStart + 1,
		);
		assert.deepEqual(
			globLinks.map((l) => l.target?.toString()),
			[],
			"Glob entries should not have links",
		);
	});
});
