import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Verifies that tool features work in asdf-style `.tool-versions` files
 * (see fixtures/tool-versions-workspace/.tool-versions).
 */
suite("Tool Versions File Test Suite", function () {
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

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, ".tool-versions"),
		);
		await vscode.window.showTextDocument(document);
	});

	test("uses the tool-versions language", () => {
		assert.equal(document.languageId, "tool-versions");
	});

	test("provides document links for declared tools", async () => {
		const links =
			(await vscode.commands.executeCommand<vscode.DocumentLink[]>(
				"vscode.executeLinkProvider",
				document.uri,
			)) ?? [];

		const shellcheckLink = links.find(
			(link) =>
				link.target?.toString() === "https://github.com/koalaman/shellcheck",
		);
		assert.ok(shellcheckLink, "Expected a link for shellcheck");

		const shellcheckLine = lineOf("shellcheck 0.10.0");
		assert.equal(shellcheckLink.range.start.line, shellcheckLine);
		assert.equal(shellcheckLink.range.start.character, 0);
		assert.equal(shellcheckLink.range.end.character, "shellcheck".length);

		const commentLine = lineOf("# tools for the tool-versions e2e suite");
		assert.deepEqual(
			links
				.filter((link) => link.range.start.line === commentLine)
				.map((link) => link.target?.toString()),
			[],
			"Comment lines should not have tool links",
		);
	});

	test("completes tool names in the first token of a line", async () => {
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				document.uri,
				new vscode.Position(lineOf("nodejs 20.11.0"), 0),
			);

		const labels = completions.items.map((item) =>
			typeof item.label === "string" ? item.label : item.label.label,
		);
		assert.ok(
			labels.includes("node"),
			`Expected registry tool "node" in completions, got ${labels.length} items`,
		);
	});

	test("provides hover for declared tools", async () => {
		const shellcheckLine = lineOf("shellcheck 0.10.0");
		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				document.uri,
				new vscode.Position(shellcheckLine, 3),
			)) ?? [];

		const hoverText = hovers
			.flatMap((hover) => hover.contents)
			.map((content) =>
				typeof content === "string"
					? content
					: (content as { value: string }).value,
			)
			.join("\n");
		assert.ok(
			hoverText.includes("Backend"),
			`Expected tool hover with backend info, got: ${hoverText}`,
		);
	});
});
