import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { TOML_EXTENSION_IDS } from "../../utils/languageServer";
import { isMiseAtLeast } from "../test-utils";

const DEADLINE_MS = 20_000;

/**
 * `mise lsp` for the mise config files, with `mise.enableLanguageServer` on
 * (see fixtures/language-server-workspace)
 */
suite("Language Server Test Suite", function () {
	this.timeout(60_000);

	let configUri: vscode.Uri;
	let document: vscode.TextDocument;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const unknownKeys = () =>
		vscode.languages
			.getDiagnostics(configUri)
			.filter((diagnostic) => diagnostic.code === "unknown-key")
			.map((diagnostic) => diagnostic.message);

	const waitUntil = async (condition: () => boolean) => {
		const deadline = Date.now() + DEADLINE_MS;
		while (!condition() && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	};

	/** the server leaves the keys to Tombi or Even Better TOML */
	const hasTomlExtension = () =>
		TOML_EXTENSION_IDS.some((id) => vscode.extensions.getExtension(id));

	suiteSetup(async function () {
		const workspaceRoot =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		configUri = vscode.Uri.file(path.join(workspaceRoot, "mise.toml"));

		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		const miseBinaryPath = miseService.getMiseBinaryPath() ?? "";
		assert.ok(miseBinaryPath, "mise binary should be resolved");
		// `mise lsp` comes with mise 2026.10.18
		if (
			!(await isMiseAtLeast(miseBinaryPath, [2026, 10, 18])) ||
			hasTomlExtension()
		) {
			this.skip();
		}

		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
		document = await vscode.workspace.openTextDocument(configUri);
		await vscode.window.showTextDocument(document);
		await waitUntil(() => unknownKeys().length > 0);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
	});

	test("reports an unknown key once, from mise lsp", () => {
		// not also from `mise config explain`
		assert.deepEqual(unknownKeys(), [
			"unknown key `experimantal`; did you mean `experimental`?",
		]);
	});

	test("offers the quick fix of mise lsp", async () => {
		const actions =
			(await vscode.commands.executeCommand<vscode.CodeAction[]>(
				"vscode.executeCodeActionProvider",
				configUri,
				new vscode.Range(2, 0, 2, "experimantal".length),
				vscode.CodeActionKind.QuickFix.value,
			)) ?? [];
		// not also the one of `mise config explain`; VS Code adds its own
		const fixes = actions.filter((action) =>
			action.title.includes("`experimental`"),
		);
		assert.deepEqual(
			fixes.map((action) => action.title),
			["Replace with `experimental`"],
		);
		// not applied: the fixture stays as it is
		const [, edits] = fixes[0]?.edit?.entries()[0] ?? [];
		assert.equal(edits?.[0]?.newText, "experimental");
	});

	const hoverText = async (line: number, character: number) => {
		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				configUri,
				new vscode.Position(line, character),
			)) ?? [];
		return hovers.flatMap((hover) =>
			hover.contents.map((content) =>
				typeof content === "string" ? content : content.value,
			),
		);
	};

	test("documents the keys", async () => {
		const description = await hoverText(5, 3);
		assert.ok(
			description.some((text) => text.includes("description of task")),
			`Expected the key documentation, got: ${description.join(" | ")}`,
		);
	});

	test("leaves the task hover to the extension", async () => {
		// `lint` in `depends = ["lint"]`
		const lint = await hoverText(7, 13);
		assert.ok(lint.length > 0, "Expected the hover of the extension");
		assert.ok(
			!lint.some((text) => text.includes("_task_")),
			`Expected no hover of mise lsp, got: ${lint.join(" | ")}`,
		);
	});

	// `lint` has a description, which mise lsp gives as the detail
	test("completes a task name once", async () => {
		const list = await vscode.commands.executeCommand<vscode.CompletionList>(
			"vscode.executeCompletionItemProvider",
			configUri,
			new vscode.Position(7, 12),
		);
		const label = (item: vscode.CompletionItem) =>
			typeof item.label === "string" ? item.label : item.label.label;
		assert.equal(list.items.filter((item) => label(item) === "lint").length, 1);
	});

	test("formats as mise fmt", async () => {
		const edits =
			(await vscode.commands.executeCommand<vscode.TextEdit[]>(
				"vscode.executeFormatDocumentProvider",
				configUri,
				{ tabSize: 2, insertSpaces: true },
			)) ?? [];
		// VS Code makes the edits minimal: applied here, not to the fixture
		const offsetOf = (position: vscode.Position) => document.offsetAt(position);
		const formatted = [...edits]
			.sort((a, b) => offsetOf(b.range.start) - offsetOf(a.range.start))
			.reduce(
				(text, edit) =>
					text.slice(0, offsetOf(edit.range.start)) +
					edit.newText +
					text.slice(offsetOf(edit.range.end)),
				document.getText(),
			);
		assert.ok(
			formatted.includes('\nrun = "echo lint"\n'),
			`Expected formatting edits, got: ${formatted}`,
		);
	});
});
