import * as assert from "node:assert";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";

const DIAGNOSTICS_DEADLINE_MS = 20_000;

/**
 * Problems of the task definitions (`mise tasks validate`) in the Problems
 * panel, and the project checks command (`mise doctor project`).
 */
suite("Task Diagnostics Test Suite", function () {
	this.timeout(60_000);

	const sandbox = sinon.createSandbox();

	let workspaceRoot: string;

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	teardown(() => {
		sandbox.restore();
	});

	/** Polls the diagnostics of a file until there is one per expected code */
	const waitForDiagnostics = async (uri: vscode.Uri, count: number) => {
		const deadline = Date.now() + DIAGNOSTICS_DEADLINE_MS;
		let diagnostics = vscode.languages.getDiagnostics(uri);
		while (diagnostics.length < count && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			diagnostics = vscode.languages.getDiagnostics(uri);
		}
		return diagnostics.filter((diagnostic) => diagnostic.source === "mise");
	};

	test("reports the problems of the tasks of mise.toml", async () => {
		const uri = vscode.Uri.file(path.join(workspaceRoot, "mise.toml"));
		const document = await vscode.workspace.openTextDocument(uri);

		const diagnostics = await waitForDiagnostics(uri, 2);
		const codes = diagnostics.map((diagnostic) => diagnostic.code).sort();
		// the templated dependency of `templated` is not reported, nor the graph
		// error repeating the missing `nope` dependency
		assert.deepStrictEqual(codes, ["invalid-timeout", "missing-dependency"]);

		const missing = diagnostics.find(
			(diagnostic) => diagnostic.code === "missing-dependency",
		);
		assert.ok(missing);
		assert.strictEqual(document.getText(missing.range), "nope");
		assert.strictEqual(missing.severity, vscode.DiagnosticSeverity.Error);
		assert.match(missing.message, /Dependency 'nope' not found/);

		const timeout = diagnostics.find(
			(diagnostic) => diagnostic.code === "invalid-timeout",
		);
		assert.ok(timeout);
		assert.strictEqual(document.getText(timeout.range), "forever");
	});

	test("reports a file task usage spec that does not parse on its #USAGE line", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "mise-tasks", "broken-usage"),
		);
		const document = await vscode.workspace.openTextDocument(uri);

		const [diagnostic, ...others] = await waitForDiagnostics(uri, 1);
		assert.ok(diagnostic, "the broken usage spec should be reported");
		assert.strictEqual(others.length, 0);
		assert.strictEqual(diagnostic.code, "usage-parse-error");
		assert.match(
			document.lineAt(diagnostic.range.start.line).text,
			/^#USAGE arg/,
		);
	});

	test("lists the project checks that did not pass", async () => {
		const showQuickPick = sandbox
			.stub(vscode.window, "showQuickPick")
			.resolves(undefined);

		await vscode.commands.executeCommand("mise.runProjectChecks");

		assert.ok(showQuickPick.calledOnce, "the checks should be listed");
		const [items, options] = showQuickPick.firstCall.args as [
			Array<vscode.QuickPickItem>,
			vscode.QuickPickOptions,
		];
		assert.deepStrictEqual(
			items.map((item) => item.label),
			["$(error) fails", "$(pass) passes"],
		);
		assert.match(items[0]?.detail ?? "", /Hint: Nothing to fix/);
		assert.strictEqual(options.title, "Project checks: 1 failed, 1 passed");
	});
});
