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

	/** Position on `word`, on the fixture line holding `marker` */
	const positionOf = (marker: string, word = marker): vscode.Position => {
		const lines = document.getText().split("\n");
		const line = lines.findIndex((text) => text.includes(marker));
		assert.ok(line >= 0, `"${marker}" should be in the fixture`);
		const character = (lines[line] ?? "").indexOf(word);
		assert.ok(character >= 0, `"${word}" should be on the ${marker} line`);
		return new vscode.Position(line, character + 1);
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

		const targetLines = definitions
			.filter((definition) =>
				definition.targetUri.path.endsWith("monorepo-workspace/mise.toml"),
			)
			.map(
				(definition) =>
					document.lineAt(
						(definition.targetSelectionRange ?? definition.targetRange).start
							.line,
					).text,
			);
		assert.ok(
			targetLines.some((text) => text.includes("[tasks.root-task]")),
			`expected a link to the declaration, got ${JSON.stringify(targetLines)}`,
		);
	});

	test("goes to the definition of a parallel tasks entry", async () => {
		const definitions = await definitionsAt(
			positionOf('"//crates/agent:build"'),
		);
		const paths = definitions.map((definition) => definition.targetUri.path);

		assert.ok(
			paths.some((targetPath) => targetPath.endsWith("crates/agent/mise.toml")),
			`expected the agent crate config, got ${JSON.stringify(paths)}`,
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
		// a plain entry is a shell command even when it names a task, and the
		// toml schema still hovers it: only our own task answers must be absent
		const position = positionOf('"echo build-all"', "build-all");

		const configLinks = (await definitionsAt(position)).filter((definition) =>
			definition.targetUri.path.endsWith("mise.toml"),
		);
		assert.deepEqual(configLinks, []);

		const hoverText = await hoverTextAt(position);
		assert.ok(
			!hoverText.includes("Build all the projects"),
			`the shell command should not describe the task, got ${hoverText}`,
		);
	});
});
