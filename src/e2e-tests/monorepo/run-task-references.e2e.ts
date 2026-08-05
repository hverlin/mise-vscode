import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * The table entries of a `run` array reference tasks
 * (https://mise.jdx.dev/tasks/task-configuration.html#run), so they navigate
 * and hover like `depends` entries. The plain strings of the same array are
 * shell commands and stay inert.
 */
suite("Run Task References Test Suite", function () {
	this.timeout(30_000);

	let workspaceRoot: string;
	let uri: vscode.Uri;
	let document: vscode.TextDocument;

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		uri = vscode.Uri.file(path.join(workspaceRoot, "mise.toml"));
		document = await vscode.workspace.openTextDocument(uri);
	});

	/** Position on `name`, on the fixture line holding it */
	const positionOf = (name: string): vscode.Position => {
		const lines = document.getText().split("\n");
		const line = lines.findIndex((text) => text.includes(name));
		assert.ok(line >= 0, `"${name}" should be in the fixture`);
		return new vscode.Position(line, (lines[line] ?? "").indexOf(name) + 1);
	};

	const definitionsAt = async (position: vscode.Position) =>
		(await vscode.commands.executeCommand<vscode.LocationLink[]>(
			"vscode.executeDefinitionProvider",
			uri,
			position,
		)) ?? [];

	const hoverTextAt = async (position: vscode.Position) => {
		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				uri,
				position,
			)) ?? [];
		return hovers
			.flatMap((hover) => hover.contents)
			.map((content) =>
				typeof content === "string"
					? content
					: (content as { value: string }).value,
			)
			.join("\n");
	};

	test("goes to the definition of the task of a run entry", async () => {
		const definitions = await definitionsAt(positionOf('"//:root-task"'));

		assert.equal(definitions.length, 1);
		const [definition] = definitions;
		assert.ok(definition, "expected a definition for //:root-task");
		assert.ok(
			definition.targetUri.path.endsWith("monorepo-workspace/mise.toml"),
			`expected the root config, got ${definition.targetUri.path}`,
		);
		const targetLine = (
			definition.targetSelectionRange ?? definition.targetRange
		).start.line;
		assert.ok(
			document.lineAt(targetLine).text.includes("[tasks.root-task]"),
			`expected the root-task header, got "${document.lineAt(targetLine).text}"`,
		);
	});

	test("goes to the definition of a parallel tasks entry", async () => {
		const definitions = await definitionsAt(
			positionOf('"//crates/agent:build"'),
		);

		assert.equal(definitions.length, 1);
		assert.ok(
			definitions[0]?.targetUri.path.endsWith("crates/agent/mise.toml"),
			`expected the agent crate config, got ${definitions[0]?.targetUri.path}`,
		);
	});

	test("hovers the task of a run entry", async () => {
		const hoverText = await hoverTextAt(positionOf('"//:root-task"'));

		assert.ok(
			hoverText.includes("Task defined at the monorepo root"),
			`the hover should describe the task, got ${hoverText}`,
		);
	});

	test("finds the run entry among the references of a task", async () => {
		// on the `[tasks.root-task]` declaration, which `verify` runs
		const declaration = positionOf("[tasks.root-task]");
		const locations =
			(await vscode.commands.executeCommand<vscode.Location[]>(
				"vscode.executeReferenceProvider",
				uri,
				new vscode.Position(
					declaration.line,
					document.lineAt(declaration.line).text.indexOf("root-task"),
				),
			)) ?? [];

		const referencingTasks = locations.map((location) =>
			document.getText(document.lineAt(location.range.start.line).range),
		);
		assert.ok(
			referencingTasks.some((text) => text.includes("[tasks.verify]")),
			`expected verify among the references, got ${JSON.stringify(referencingTasks)}`,
		);
	});

	test("leaves the shell commands of the same array alone", async () => {
		const position = positionOf('"echo verified"');

		assert.deepEqual(await definitionsAt(position), []);
		assert.equal(await hoverTextAt(position), "");
	});
});
