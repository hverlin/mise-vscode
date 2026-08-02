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
		// the fixture enables the experimental setting that gates script tasks,
		// so a missing node: task means the mise version is too old
		assert.ok(
			tasks.some((t) => t.name.startsWith("node:")),
			"This mise version does not discover package.json script tasks, update mise to the latest version to run this suite",
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
			"//crates/agent:build",
			"//crates/protocol:build",
			"//go/gateway:build",
			"//projects/backend/integration:test",
			"//projects/backend:build",
			"//projects/backend:deploy",
			"//projects/backend:format",
			// declared with `extends = "project-info"`
			"//projects/backend:info",
			"//projects/backend:release",
			"//projects/backend:seed",
			"//projects/frontend:build",
			"//projects/frontend:bundle",
			"//projects/frontend:ci",
			"//projects/frontend:db:reset",
			"//projects/frontend:dev",
			"//projects/frontend:e2e",
			// depends on the build tasks of upstream projects with `^build`
			"//projects/frontend:package",
			// toml task shadowing the package.json `start` script
			"//projects/frontend:start",
			"node:@fixture/shared#lint",
			"node:backend#test",
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

	test("Should execute a task of a rust crate project via the VSCode tasks API", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
		const crateTask = tasks.find((t) => t.name === "//crates/agent:build");
		assert.ok(crateTask, "//crates/agent:build task should be found");

		// runs //crates/protocol:build first through its depends
		await executeTaskAndWait(crateTask);
	});

	test("Should report workspace projects of every ecosystem in the tasks graph", () => {
		const stdout = execSync("mise tasks graph --json", {
			cwd: workspaceRoot,
			encoding: "utf8",
		});
		const graph = JSON.parse(stdout) as {
			projects: Array<{ id: string; root: string; dependencies?: string[] }>;
		};
		const byId = new Map(graph.projects.map((p) => [p.id, p]));

		assert.deepEqual(
			[...byId.keys()].sort(),
			[
				"cargo:agent",
				// not a workspace member, registered through a path dependency
				"cargo:build-helper",
				"cargo:protocol",
				"cargo:shared",
				"go:example.com/fixture/auth",
				"go:example.com/fixture/gateway",
				"node:@fixture/shared",
				"node:backend",
				"node:frontend",
				"uv:monorepo-fixture",
				"uv:py-service",
				"uv:py-shared",
			],
			"every ecosystem should contribute its workspace projects",
		);

		// cargo edges cover renamed, workspace-inherited dev, and
		// target-specific build dependencies
		assert.deepEqual(byId.get("cargo:agent")?.dependencies, [
			"cargo:build-helper",
			"cargo:protocol",
			"cargo:shared",
		]);
		assert.deepEqual(byId.get("uv:py-service")?.dependencies, ["uv:py-shared"]);
		assert.deepEqual(byId.get("node:frontend")?.dependencies, [
			"node:@fixture/shared",
			"node:backend",
		]);
		// edge declared with [monorepo.projects] in the root config
		assert.deepEqual(byId.get("go:example.com/fixture/gateway")?.dependencies, [
			"go:example.com/fixture/auth",
		]);
	});

	test("Should report turbo.json dependsOn as depends of script tasks", () => {
		const stdout = execSync("mise tasks ls --all --json", {
			cwd: workspaceRoot,
			encoding: "utf8",
		});
		const tasks = JSON.parse(stdout) as Array<{
			name: string;
			depends?: Array<string | string[] | { task: string; optional?: boolean }>;
			sources?: string[];
			outputs?: string[];
		}>;
		const frontendTest = tasks.find((t) => t.name === "node:frontend#test");
		assert.ok(frontendTest, "node:frontend#test should be found");

		// `^test` from turbo.json resolves to the test task of every dependency
		// package, reported as object entries (missing ones are optional)
		const dependsTasks = (frontendTest.depends ?? []).map((d) =>
			typeof d === "string" || Array.isArray(d) ? d : d.task,
		);
		assert.deepEqual(dependsTasks.sort(), [
			"//projects/backend:test",
			"//projects/shared:test",
		]);

		// inputs/outputs metadata is imported from turbo.json
		assert.deepEqual(frontendTest.sources, ["src/**"]);
		assert.deepEqual(frontendTest.outputs, ["coverage/**"]);
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
			"//projects/frontend:package",
			"//projects/frontend:start",
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

	test("Should resolve ^task depends to the tasks of upstream projects", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "projects", "frontend", "mise.toml"),
		);
		const document = await vscode.workspace.openTextDocument(uri);

		const lines = document.getText().split("\n");
		const lineIndex = lines.findIndex((line) => line.includes('"^build"'));
		assert.ok(lineIndex >= 0, "depends line should be found in the fixture");
		const character = (lines[lineIndex]?.indexOf("^build") ?? 0) + 1;

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
		// of the upstream projects (backend, @fixture/shared), only the backend
		// defines a build task
		assert.equal(
			targetPaths.length,
			1,
			`expected a single upstream build task, got ${JSON.stringify(targetPaths)}`,
		);
		assert.ok(
			targetPaths[0]?.endsWith("projects/backend/mise.toml"),
			`^build should resolve to the backend config, got ${targetPaths[0]}`,
		);
	});

	test("Should resolve extends to the task template definition", async () => {
		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "projects", "backend", "mise.toml"),
		);
		const document = await vscode.workspace.openTextDocument(uri);

		const lines = document.getText().split("\n");
		const lineIndex = lines.findIndex((line) =>
			line.includes('extends = "project-info"'),
		);
		assert.ok(lineIndex >= 0, "extends line should be found in the fixture");
		const character = (lines[lineIndex]?.indexOf("project-info") ?? 0) + 1;

		const locations = await vscode.commands.executeCommand<
			(vscode.Location | vscode.LocationLink)[]
		>(
			"vscode.executeDefinitionProvider",
			uri,
			new vscode.Position(lineIndex, character),
		);

		assert.equal(locations.length, 1, "the template definition should resolve");
		const location = locations[0];
		assert.ok(location, "A definition location should be returned");
		const targetUri =
			"targetUri" in location ? location.targetUri : location.uri;
		assert.ok(
			targetUri.path.endsWith("monorepo-workspace/mise.toml"),
			`extends should resolve to the root config, got ${targetUri.path}`,
		);

		const rootDocument = await vscode.workspace.openTextDocument(targetUri);
		const expectedLine = rootDocument
			.getText()
			.split("\n")
			.findIndex((line) => line.includes("[task_templates.project-info]"));
		const targetRange =
			"range" in location
				? location.range
				: (location.targetSelectionRange ?? location.targetRange);
		assert.equal(targetRange.start.line, expectedLine);
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

	test("Should open the toml definition of a task shadowing a package.json script", async () => {
		stubShowQuickPickWithText(sandbox, "//projects/frontend:start");

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
			.findIndex((line) => line.includes("[tasks.start]"));
		assert.equal(editor.selection.start.line, expectedLine);
	});

	test("Should open the task definition from the search action without running it", async () => {
		stubShowQuickPickWithText(sandbox, "//projects/backend:build");

		await vscode.commands.executeCommand("mise.searchTasks");

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, "An editor should be opened");
		assert.ok(
			editor.document.uri.fsPath.endsWith(
				path.join("projects", "backend", "mise.toml"),
			),
			`Should open the backend config, got ${editor.document.uri.fsPath}`,
		);
		const expectedLine = editor.document
			.getText()
			.split("\n")
			.findIndex((line) => line.includes("[tasks.build]"));
		assert.equal(editor.selection.start.line, expectedLine);
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
