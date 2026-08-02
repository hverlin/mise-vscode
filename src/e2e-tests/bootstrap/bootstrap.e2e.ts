import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Bootstrap e2e tests. Everything here is read-only and machine-agnostic:
 * `mise bootstrap` is never executed (only definition navigation and command
 * registration are exercised), the fixture entries point at resources that do
 * not exist anywhere, and the suite isolates the machine's global mise config
 * via MISE_GLOBAL_CONFIG_FILE (see .vscode-test.js), so results are identical
 * on macOS (dev machines) and Linux (CI).
 */
suite("Bootstrap Test Suite", function () {
	this.timeout(30_000);

	let workspaceRoot: string;
	let miseTomlDocument: vscode.TextDocument;

	const lineOf = (text: string): number => {
		for (let i = 0; i < miseTomlDocument.lineCount; i++) {
			if (miseTomlDocument.lineAt(i).text.includes(text)) {
				return i;
			}
		}
		assert.fail(`Line containing "${text}" not found in fixture`);
	};

	const openDefinition = async (tablePath: string[], key: string) => {
		await vscode.commands.executeCommand("mise.openBootstrapEntryDefinition", {
			label: key,
			state: "missing",
			definition: { tablePath, key },
		});
		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, "An editor should be opened");
		return editor;
	};

	suiteSetup(async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(root, "Workspace root should be available");
		workspaceRoot = root;

		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "Extension should be available");
		await extension.activate();

		miseTomlDocument = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);
	});

	test("bootstrap commands are registered", async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const command of [
			"mise.runBootstrap",
			"mise.runBootstrapDryRun",
			"mise.showBootstrap",
			"mise.openBootstrapEntryDefinition",
		]) {
			assert.ok(
				commands.includes(command),
				`Command ${command} should be registered`,
			);
		}
	});

	test("navigates to a [bootstrap.repos] entry declaration", async () => {
		const editor = await openDefinition(
			["bootstrap", "repos"],
			"vendor/mise-e2e-repo",
		);

		assert.ok(
			editor.document.fileName.endsWith("mise.toml"),
			`Should open mise.toml, got ${editor.document.fileName}`,
		);
		assert.equal(
			editor.selection.start.line,
			lineOf('"vendor/mise-e2e-repo"'),
			"Selection should be on the repo declaration line",
		);
	});

	test("navigates to a [dotfiles] entry declaration", async () => {
		const editor = await openDefinition(
			["dotfiles"],
			"~/.mise-vscode-e2e-dotfile",
		);

		assert.equal(
			editor.selection.start.line,
			lineOf('"~/.mise-vscode-e2e-dotfile"'),
			"Selection should be on the dotfile declaration line",
		);
	});

	test("navigates to a [bootstrap.macos.defaults] key declaration", async () => {
		const editor = await openDefinition(
			["bootstrap", "macos", "defaults", "com.example.mise-vscode-e2e"],
			"ExampleKey",
		);

		assert.equal(
			editor.selection.start.line,
			lineOf("ExampleKey"),
			"Selection should be on the defaults key line",
		);
	});

	test("navigates to a [bootstrap.macos.finder] shorthand declaration", async () => {
		// mise resolves `[bootstrap.macos.finder] show_pathbar` to
		// `com.apple.finder ShowPathbar` in status output; navigation must find
		// the shorthand declaration via the alternates
		await vscode.commands.executeCommand("mise.openBootstrapEntryDefinition", {
			label: "com.apple.finder ShowPathbar",
			state: "unset",
			definition: {
				tablePath: ["bootstrap", "macos", "defaults", "com.apple.finder"],
				key: "ShowPathbar",
			},
			alternates: [
				{ tablePath: ["bootstrap", "macos", "finder"], key: "show_pathbar" },
			],
		});
		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, "An editor should be opened");

		assert.equal(
			editor.selection.start.line,
			lineOf("show_pathbar"),
			"Selection should be on the shorthand declaration line",
		);
	});

	test("falls back to the enclosing table when the key does not exist", async () => {
		const editor = await openDefinition(
			["bootstrap", "macos", "defaults", "com.example.mise-vscode-e2e"],
			"KeyThatDoesNotExist",
		);

		assert.equal(
			editor.selection.start.line,
			lineOf('"com.example.mise-vscode-e2e"'),
			"Selection should fall back to the domain table declaration",
		);
	});

	test("does not throw for an entry declared nowhere", async () => {
		await vscode.commands.executeCommand("mise.openBootstrapEntryDefinition", {
			label: "ghost",
			state: "missing",
			definition: { tablePath: ["bootstrap", "repos"], key: "does/not-exist" },
		});
	});

	test("show bootstrap status webview opens without error", async () => {
		await vscode.commands.executeCommand("mise.showBootstrap");
	});
});
