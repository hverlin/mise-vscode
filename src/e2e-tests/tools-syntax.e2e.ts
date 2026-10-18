import * as assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Verifies that tool document links work for every way tools can be declared
 * in TOML (see fixtures/task-execution-workspace/tools-syntax.toml):
 * - `[tools]` block entries (plain, inline tables, dotted keys, version arrays)
 * - `[tools.<name>]` sections with options (version, postinstall, ...)
 * - `tools = { ... }` and `tools.<name> = ...` inside tasks
 */
suite("Tools TOML Syntax Test Suite", function () {
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

	const linksOnLine = (line: number) =>
		links.filter((link) => link.range.start.line === line);

	const findLink = (target: string) =>
		links.find((link) => link.target?.toString() === target);

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "tools-syntax.toml"),
		);
		await vscode.window.showTextDocument(document);

		links =
			(await vscode.commands.executeCommand<vscode.DocumentLink[]>(
				"vscode.executeLinkProvider",
				document.uri,
			)) ?? [];
	});

	test("links plain quoted tools in the [tools] block", () => {
		const link = findLink("https://github.com/cli/cli");
		assert.ok(link, "Expected a link for github:cli/cli");
		assert.equal(link.range.start.line, lineOf('"github:cli/cli"'));
	});

	test("links tools declared with an inline options table", () => {
		const link = findLink("https://github.com/BurntSushi/ripgrep");
		assert.ok(link, "Expected a link for aqua:BurntSushi/ripgrep");
		assert.equal(link.range.start.line, lineOf('"aqua:BurntSushi/ripgrep"'));
	});

	test("links tools declared with dotted keys", () => {
		const link = findLink("https://github.com/sharkdp/fd");
		assert.ok(link, 'Expected a link for "ubi:sharkdp/fd".version');
		assert.equal(link.range.start.line, lineOf('"ubi:sharkdp/fd"'));
	});

	test("links tools declared as [tools.<name>] sections", () => {
		const link = findLink("https://github.com/jdx/mise");
		assert.ok(link, 'Expected a link for [tools."github:jdx/mise"]');

		const headerLine = lineOf('[tools."github:jdx/mise"]');
		assert.equal(link.range.start.line, headerLine);
		// The link should cover the quoted tool name, not the `[tools.` prefix
		assert.ok(
			link.range.start.character >= "[tools.".length,
			"Link should start after the [tools. prefix",
		);
	});

	test("links [tools.<name>] sections for non-github backends", () => {
		assert.ok(
			findLink("https://gitlab.com/gitlab-org/cli"),
			'Expected a link for [tools."gitlab:gitlab-org/cli"]',
		);
		assert.ok(
			findLink("https://github.com/version-fox/vfox-cmake"),
			'Expected a link for [tools."vfox:version-fox/vfox-cmake"]',
		);
	});

	test("links tools in a task inline table", () => {
		const link = findLink("https://github.com/sharkdp/bat");
		assert.ok(
			link,
			"Expected a link for github:sharkdp/bat in tools = { ... }",
		);
		assert.equal(link.range.start.line, lineOf('"github:sharkdp/bat"'));
	});

	test("links tools declared as tools.<name> in a task", () => {
		const link = findLink("https://github.com/BurntSushi/xsv");
		assert.ok(link, 'Expected a link for tools."ubi:BurntSushi/xsv"');
		assert.equal(link.range.start.line, lineOf('"ubi:BurntSushi/xsv"'));
	});

	test("completes tool names in a [tools.<name>] section header", async () => {
		// a copy with the header being typed: an edit left in the fixture would
		// be saved to disk by the next test running a task (it saves all files)
		const scratchDir = await mkdtemp(path.join(tmpdir(), "mise-vscode-e2e-"));
		const scratchPath = path.join(scratchDir, "tools-syntax.toml");
		await writeFile(scratchPath, `${document.getText()}\n[tools.`);
		const scratch = await vscode.workspace.openTextDocument(scratchPath);

		try {
			const headerLine = scratch.lineCount - 1;
			assert.equal(scratch.lineAt(headerLine).text, "[tools.");

			const completions =
				await vscode.commands.executeCommand<vscode.CompletionList>(
					"vscode.executeCompletionItemProvider",
					scratch.uri,
					new vscode.Position(headerLine, "[tools.".length),
					".",
				);

			const labels = completions.items.map((item) =>
				typeof item.label === "string" ? item.label : item.label.label,
			);
			assert.ok(
				labels.includes("node"),
				`Expected registry tool "node" in completions, got ${labels.length} items`,
			);
			assert.ok(
				labels.some((label) => label.endsWith(":")),
				"Expected backend completions (e.g. npm:) in the header",
			);
		} finally {
			await rm(scratchDir, { recursive: true, force: true });
		}
	});

	test("does not offer task completions in a tool depends array", async () => {
		const dependsLine = lineOf('depends = ["node"]');
		const lineText = document.lineAt(dependsLine).text;
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				document.uri,
				new vscode.Position(dependsLine, lineText.indexOf('["') + 2),
				'"',
			);

		const labels = completions.items.map((item) =>
			typeof item.label === "string" ? item.label : item.label.label,
		);
		// `depends` on a tool refers to other tools; the workspace tasks
		// (test-e2e, echo-hello) must not be suggested here
		assert.ok(
			!labels.includes("test-e2e") && !labels.includes("echo-hello"),
			`Task names should not be offered in a tool depends array, got: ${labels.join(", ")}`,
		);
	});

	test("does not link option lines inside [tools.<name>] sections", () => {
		const optionLines = [
			lineOf('version = "2025.1.1"'),
			lineOf('postinstall = "echo postinstall-done"'),
			lineOf('depends = ["node"]'),
			lineOf('version = "1.60.0"'),
			lineOf('version = "3.30.0"'),
		];
		for (const line of optionLines) {
			assert.deepEqual(
				linksOnLine(line).map((l) => l.target?.toString()),
				[],
				`Option line ${line + 1} should not have tool links`,
			);
		}
	});
});
