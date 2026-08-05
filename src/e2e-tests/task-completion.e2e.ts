import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Task name completion in the fields that reference tasks
 * (https://mise.jdx.dev/tasks/task-configuration.html): `depends`,
 * `depends_post`, `wait_for`, and the table entries of `run`.
 */
suite("Task Name Completion Test Suite", function () {
	this.timeout(30_000);

	const workspaceTasks = ["echo-hello", "greet", "test-e2e"];
	let document: vscode.TextDocument;

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "task-references.toml"),
		);
	});

	const lineOf = (text: string): number => {
		for (let i = 0; i < document.lineCount; i++) {
			if (document.lineAt(i).text.includes(text)) {
				return i;
			}
		}
		assert.fail(`Line containing "${text}" not found in fixture`);
	};

	/** Position just inside the opening quote of `value` on the `marker` line */
	const insideValue = (marker: string, value: string): vscode.Position => {
		const line = lineOf(marker);
		const character = document.lineAt(line).text.indexOf(value);
		assert.ok(character !== -1, `"${value}" not found on the ${marker} line`);
		return new vscode.Position(line, character + 1);
	};

	// other providers (and the toml schema) complete at these positions too,
	// only the task names are ours
	const completedTaskNames = async (
		position: vscode.Position,
	): Promise<string[]> => {
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				document.uri,
				position,
			);
		return completions.items
			.map((item) =>
				typeof item.label === "string" ? item.label : item.label.label,
			)
			.filter((label) => workspaceTasks.includes(label));
	};

	test("completes the task of a run entry, in a multiline array", async () => {
		const entry = '{ task = "echo-hello" }';
		assert.ok(
			lineOf(entry) > lineOf("run = ["),
			"the fixture should open its run array on an earlier line",
		);

		const names = await completedTaskNames(insideValue(entry, '"echo-hello"'));
		assert.deepEqual(names.sort(), workspaceTasks);
	});

	test("completes the parallel tasks of a run entry", async () => {
		const marker = '{ tasks = ["echo-hello", "test-e2e"] }';
		assert.deepEqual(
			(await completedTaskNames(insideValue(marker, '"echo-hello"'))).sort(),
			workspaceTasks,
		);
		assert.deepEqual(
			(await completedTaskNames(insideValue(marker, '"test-e2e"'))).sort(),
			workspaceTasks,
		);
	});

	test("does not complete the shell commands of a run array", async () => {
		const names = await completedTaskNames(
			insideValue('"echo end"', '"echo end"'),
		);
		assert.deepEqual(names, []);
	});

	test("does not complete the args and env of a run entry", async () => {
		const marker = '{ task = "greet", args =';
		assert.deepEqual(
			await completedTaskNames(insideValue(marker, '"--loud"')),
			[],
		);
		assert.deepEqual(await completedTaskNames(insideValue(marker, '"1"')), []);
	});

	test("completes depends, depends_post and wait_for entries", async () => {
		assert.deepEqual(
			(
				await completedTaskNames(
					insideValue('depends = ["echo-hello"]', '"echo-hello"'),
				)
			).sort(),
			workspaceTasks,
		);
		assert.deepEqual(
			(
				await completedTaskNames(
					insideValue("wait_for = [{ task =", '"test-e2e"'),
				)
			).sort(),
			workspaceTasks,
		);
	});

	test("completes only the task of a [task, args] depends entry", async () => {
		const marker = 'depends_post = [["greet"';
		assert.deepEqual(
			(await completedTaskNames(insideValue(marker, '"greet"'))).sort(),
			workspaceTasks,
		);
		assert.deepEqual(
			await completedTaskNames(insideValue(marker, '"--loud"')),
			[],
		);
	});
});
