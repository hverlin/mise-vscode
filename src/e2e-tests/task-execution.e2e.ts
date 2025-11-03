import * as assert from "node:assert";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { stubShowQuickPickWithText } from "./test-utils";

suite("Task Execution Test Suite", function () {
	this.timeout(10_000);

	const sandbox = sinon.createSandbox();

	teardown(() => {
		sandbox.restore();
	});

	let miseTomlPath: string;

	setup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");
		console.log("Workspace folders:", vscode.workspace.workspaceFolders);

		miseTomlPath = path.join(workspaceRoot, "mise.toml");
		console.log(`Using mise.toml at: ${miseTomlPath}`);
	});

	test("Should be able to run a mise task via command", async () => {
		const doc = await vscode.workspace.openTextDocument(miseTomlPath);
		await vscode.window.showTextDocument(doc);

		const getSelectedLabel = stubShowQuickPickWithText(sandbox, "test-e2e");

		await vscode.commands.executeCommand("mise.runTask");

		const selectedTaskLabel = getSelectedLabel();
		assert.equal(selectedTaskLabel, "test-e2e");
	});

	test("Should be able to execute mise tasks via VSCode tasks API", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });

		assert.deepEqual(
			tasks.map((t) => t.name),
			["echo-hello", "test-e2e"],
		);

		const echoTask = tasks.find((t) => t.name === "echo-hello");
		assert.ok(echoTask, "echo-hello task should be found");

		// biome-ignore lint/style/noNonNullAssertion: we have an assert above
		const execution = await vscode.tasks.executeTask(echoTask!);
		assert.ok(execution, "Task execution should start");

		await new Promise<void>((resolve, reject) => {
			const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
				if (e.execution === execution) {
					disposable.dispose();
					if (e.exitCode === 0) {
						resolve();
					} else {
						reject(new Error(`Task failed with exit code ${e.exitCode}`));
					}
				}
			});
		});
	});
});
