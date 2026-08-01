import * as assert from "node:assert";
import { execSync } from "node:child_process";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { stubShowQuickPickWithText } from "../test-utils";

suite("Monorepo Tasks Test Suite", function () {
	this.timeout(20_000);

	const sandbox = sinon.createSandbox();

	let workspaceRoot: string;

	suiteSetup(() => {
		// fail with a clear message instead of confusing test failures when the
		// local mise is too old (CI and local development test against latest)
		const fixtureRoot =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		let stdout: string;
		try {
			stdout = execSync("mise tasks ls --all --json", {
				cwd: fixtureRoot,
				encoding: "utf8",
			});
		} catch (error) {
			throw new Error(
				`Unable to list monorepo tasks, update mise to the latest version to run this suite (${error})`,
			);
		}
		const tasks = JSON.parse(stdout) as Array<{ name: string }>;
		assert.ok(
			tasks.some((t) => t.name.startsWith("node:")),
			"This mise version does not discover workspace script tasks, update mise to the latest version to run this suite",
		);
	});

	setup(() => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
	});

	teardown(() => {
		sandbox.restore();
	});

	const executeTaskAndWait = async (task: vscode.Task) => {
		const execution = await vscode.tasks.executeTask(task);
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
	};

	test("Should list all monorepo tasks with fully qualified names", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });

		assert.deepEqual(tasks.map((t) => t.name).sort(), [
			"//:build-all",
			"//:clean",
			"//:root-task",
			"//:verify",
			"//projects/backend/integration:test",
			"//projects/backend:build",
			"//projects/backend:deploy",
			"//projects/backend:format",
			"//projects/backend:release",
			"//projects/backend:seed",
			"//projects/frontend:build",
			"//projects/frontend:bundle",
			"//projects/frontend:ci",
			"//projects/frontend:db:reset",
			"//projects/frontend:dev",
			"//projects/frontend:e2e",
			"node:backend#test",
			"node:frontend#start",
			"node:frontend#test",
		]);
	});

	test("Should execute a subproject task via the VSCode tasks API", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
		const buildTask = tasks.find((t) => t.name === "//projects/frontend:build");
		assert.ok(buildTask, "//projects/frontend:build task should be found");

		await executeTaskAndWait(buildTask);
	});

	test("Should execute a package.json script task via the VSCode tasks API", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
		const scriptTask = tasks.find((t) => t.name === "node:frontend#test");
		assert.ok(scriptTask, "node:frontend#test task should be found");

		await executeTaskAndWait(scriptTask);
	});

	test("Should execute a file task of a subproject via the VSCode tasks API", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
		const fileTask = tasks.find((t) => t.name === "//projects/frontend:e2e");
		assert.ok(fileTask, "//projects/frontend:e2e task should be found");

		await executeTaskAndWait(fileTask);
	});

	test("Should provide code lenses with fully qualified task names", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "projects", "frontend", "mise.toml"),
		);
		await vscode.workspace.openTextDocument(uri);

		const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
			"vscode.executeCodeLensProvider",
			uri,
		);

		const runTaskArgs = (codeLenses ?? [])
			.filter((lens) => lens.command?.command === "mise.runTask")
			.map((lens) => lens.command?.arguments?.[0]);

		assert.deepEqual(runTaskArgs.sort(), [
			"//projects/frontend:build",
			"//projects/frontend:ci",
			"//projects/frontend:dev",
		]);
	});

	test("Should resolve :task references in depends to the sibling task", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "projects", "backend", "mise.toml"),
		);
		const document = await vscode.workspace.openTextDocument(uri);

		const lines = document.getText().split("\n");
		const lineIndex = lines.findIndex((line) => line.includes('":build"'));
		assert.ok(lineIndex >= 0, "depends line should be found in the fixture");
		const character = (lines[lineIndex]?.indexOf(":build") ?? 0) + 1;

		const locations = await vscode.commands.executeCommand<
			(vscode.Location | vscode.LocationLink)[]
		>(
			"vscode.executeDefinitionProvider",
			uri,
			new vscode.Position(lineIndex, character),
		);

		assert.ok(locations.length > 0, "The :build reference should resolve");
		const location = locations[0];
		assert.ok(location, "A definition location should be returned");
		const targetUri =
			"targetUri" in location ? location.targetUri : location.uri;
		assert.ok(
			targetUri.path.endsWith("projects/backend/mise.toml"),
			`:build should resolve to the backend config, got ${targetUri.path}`,
		);
	});

	test("Should resolve depends on a package.json script to the script definition", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "projects", "frontend", "mise.toml"),
		);
		const document = await vscode.workspace.openTextDocument(uri);

		const lines = document.getText().split("\n");
		const lineIndex = lines.findIndex((line) => line.includes('":test"'));
		assert.ok(lineIndex >= 0, "depends line should be found in the fixture");
		const character = (lines[lineIndex]?.indexOf(":test") ?? 0) + 1;

		const locations = await vscode.commands.executeCommand<
			(vscode.Location | vscode.LocationLink)[]
		>(
			"vscode.executeDefinitionProvider",
			uri,
			new vscode.Position(lineIndex, character),
		);

		assert.ok(locations.length > 0, "The :test reference should resolve");
		const location = locations[0];
		assert.ok(location, "A definition location should be returned");
		const targetUri =
			"targetUri" in location ? location.targetUri : location.uri;
		assert.ok(
			targetUri.path.endsWith("projects/frontend/package.json"),
			`:test should resolve to the frontend package.json, got ${targetUri.path}`,
		);

		// the target range should point at the "test" script, not the top of the file
		const packageJsonDocument = await vscode.workspace.openTextDocument(
			vscode.Uri.file(
				path.join(workspaceRoot, "projects", "frontend", "package.json"),
			),
		);
		const expectedLine = packageJsonDocument
			.getText()
			.split("\n")
			.findIndex((line) => line.includes('"test"'));
		const targetRange =
			"range" in location
				? location.range
				: (location.targetSelectionRange ?? location.targetRange);
		assert.equal(targetRange.start.line, expectedLine);
	});

	test("Should resolve wildcard depends to every matching task", async () => {
		const uri = vscode.Uri.file(path.join(workspaceRoot, "mise.toml"));
		const document = await vscode.workspace.openTextDocument(uri);

		const lines = document.getText().split("\n");
		const lineIndex = lines.findIndex((line) =>
			line.includes('"//projects/...:build"'),
		);
		assert.ok(lineIndex >= 0, "depends line should be found in the fixture");
		const character =
			(lines[lineIndex]?.indexOf("//projects/...:build") ?? 0) + 3;

		const locations = await vscode.commands.executeCommand<
			(vscode.Location | vscode.LocationLink)[]
		>(
			"vscode.executeDefinitionProvider",
			uri,
			new vscode.Position(lineIndex, character),
		);

		const targetPaths = locations.map(
			(location) =>
				("targetUri" in location ? location.targetUri : location.uri).path,
		);
		assert.equal(
			targetPaths.length,
			2,
			`the wildcard should resolve to both build tasks, got ${JSON.stringify(targetPaths)}`,
		);
		assert.ok(
			targetPaths.some((p) => p.endsWith("projects/frontend/mise.toml")),
			`expected the frontend build task, got ${JSON.stringify(targetPaths)}`,
		);
		assert.ok(
			targetPaths.some((p) => p.endsWith("projects/backend/mise.toml")),
			`expected the backend build task, got ${JSON.stringify(targetPaths)}`,
		);
	});

	test("Should find dependent tasks across the monorepo", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "projects", "frontend", "mise.toml"),
		);
		const document = await vscode.workspace.openTextDocument(uri);

		const headerLine = document
			.getText()
			.split("\n")
			.findIndex((line) => line.includes("[tasks.build]"));
		assert.ok(headerLine >= 0, "[tasks.build] should be found in the fixture");
		const character = document.lineAt(headerLine).text.indexOf("build");
		const locations = await vscode.commands.executeCommand<vscode.Location[]>(
			"vscode.executeReferenceProvider",
			uri,
			new vscode.Position(headerLine, character),
		);

		const locationPaths = locations.map((location) => location.uri.path);

		// build-all and verify depend on it via wildcards, ci via a bare name
		assert.ok(
			locationPaths.some((p) => p.endsWith("monorepo-workspace/mise.toml")),
			`the root tasks should reference the frontend build task, got ${JSON.stringify(locationPaths)}`,
		);
		assert.ok(
			locationPaths.some((p) => p.endsWith("projects/frontend/mise.toml")),
			`the ci task should reference the frontend build task, got ${JSON.stringify(locationPaths)}`,
		);
	});

	test("Should open the task definition of a subproject task", async () => {
		stubShowQuickPickWithText(sandbox, "//projects/frontend:build");

		await vscode.commands.executeCommand("mise.openTaskDefinition");

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, "An editor should be opened");
		assert.ok(
			editor.document.uri.fsPath.endsWith(
				path.join("projects", "frontend", "mise.toml"),
			),
			`Should open the frontend config, got ${editor.document.uri.fsPath}`,
		);
		const expectedLine = editor.document
			.getText()
			.split("\n")
			.findIndex((line) => line.includes("[tasks.build]"));
		assert.equal(editor.selection.start.line, expectedLine);
		assert.ok(
			!editor.selection.isEmpty,
			"The task definition should be selected",
		);
	});

	test("Should offer fully qualified task names in the run task picker", async () => {
		const getSelectedLabel = stubShowQuickPickWithText(
			sandbox,
			"//projects/backend:build",
		);

		await vscode.commands.executeCommand("mise.runTask");

		assert.equal(getSelectedLabel(), "//projects/backend:build");
	});
});
