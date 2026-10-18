import * as assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

	test("completes backend prefixes in the first token of a line", async () => {
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
			labels.includes("core:") && labels.includes("npm:"),
			`Expected backend prefixes (core:, npm:) in completions, got ${labels.length} items`,
		);
	});

	test("completes registry tools after a backend prefix", async () => {
		const editor = await vscode.window.showTextDocument(document);
		const lastLine = document.lineCount - 1;
		await editor.edit((edit) => {
			edit.insert(
				new vscode.Position(lastLine, document.lineAt(lastLine).text.length),
				"\ncore:",
			);
		});

		try {
			const backendLine = lineOf("core:");
			const completions =
				await vscode.commands.executeCommand<vscode.CompletionList>(
					"vscode.executeCompletionItemProvider",
					document.uri,
					new vscode.Position(backendLine, "core:".length),
				);

			const labels = completions.items.map((item) =>
				typeof item.label === "string" ? item.label : item.label.label,
			);
			assert.ok(
				labels.includes("core:node"),
				`Expected "core:node" after the core: prefix, got: ${labels.slice(0, 20).join(", ")}`,
			);
			assert.ok(
				labels.every((label) => label.startsWith("core:")),
				`Only core: tools should be offered after the core: prefix, got: ${labels.slice(0, 20).join(", ")}`,
			);
		} finally {
			await vscode.commands.executeCommand("undo");
		}
	});

	test("describes the registry tools in the completions", async () => {
		// a file of its own: the fixture is left as it is
		const scratchDir = await mkdtemp(path.join(tmpdir(), "mise-vscode-e2e-"));
		const scratchPath = path.join(scratchDir, ".tool-versions");
		await writeFile(scratchPath, "core:");
		try {
			const scratch = await vscode.workspace.openTextDocument(scratchPath);
			const completions =
				await vscode.commands.executeCommand<vscode.CompletionList>(
					"vscode.executeCompletionItemProvider",
					scratch.uri,
					new vscode.Position(0, "core:".length),
					undefined,
					// resolve every item, as VS Code does for the one the user looks at
					200,
				);

			const node = completions.items.find(
				(item) =>
					(typeof item.label === "string" ? item.label : item.label.label) ===
					"core:node",
			);
			assert.ok(node, "Expected core:node after the core: prefix");
			const documentation =
				typeof node.documentation === "string"
					? node.documentation
					: node.documentation?.value;
			assert.match(
				documentation ?? "",
				/JavaScript/,
				`Expected the registry description of node, got: ${documentation}`,
			);
		} finally {
			await rm(scratchDir, { recursive: true, force: true });
		}
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
			hoverText.includes("**shellcheck** · ") &&
				hoverText.includes("**Version**"),
			`Expected tool hover with the backend and the version, got: ${hoverText}`,
		);
	});

	test("shows the website of the project in the hover", async () => {
		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				document.uri,
				new vscode.Position(lineOf("dart 3.5.0"), 1),
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
			hoverText.includes("**Website** [dart\\.dev](<https://dart.dev/>)"),
			`Expected the website from the registry in the hover, got: ${hoverText}`,
		);
	});
});
