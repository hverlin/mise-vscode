import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../miseService";

/**
 * Usage spec support (https://usage.jdx.dev/spec/):
 * - `mise tasks info --json` parsing of args/flags
 * - completions inside `usage = '''...'''` blocks of mise.toml
 * - completions after `#USAGE` / `#MISE` in shell file tasks
 */
suite("Usage Spec Test Suite", function () {
	this.timeout(30_000);

	let workspaceRoot: string;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	suiteSetup(() => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
	});

	const getCompletionLabels = async (
		uri: vscode.Uri,
		position: vscode.Position,
	) => {
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				uri,
				position,
			);
		return completions.items.map((item) =>
			typeof item.label === "string" ? item.label : item.label.label,
		);
	};

	test("getTaskInfo parses args and flags from the usage spec", async () => {
		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		assert.ok(miseService.getMiseBinaryPath(), "mise binary should resolve");

		const info = await miseService.getTaskInfo("greet");
		assert.ok(info, "task info should be returned for greet");

		assert.equal(info.usageSpec.args.length, 1);
		const arg = info.usageSpec.args[0];
		assert.equal(arg?.name, "name");
		assert.equal(arg?.required, true);
		assert.equal(arg?.help, "Name to greet");
		assert.deepEqual(arg?.choices, ["alice", "bob"]);

		assert.equal(info.usageSpec.flags.length, 2);
		const greeting = info.usageSpec.flags.find(
			(flag) => flag.name === "--greeting",
		);
		assert.ok(greeting, "--greeting flag should be parsed");
		assert.equal(greeting?.arg, "greeting");
		assert.equal(greeting?.default, "hello");
		assert.equal(greeting?.help, "Greeting to use");

		const loud = info.usageSpec.flags.find((flag) => flag.name === "--loud");
		assert.ok(loud, "-l --loud flag should be parsed");
		assert.equal(loud?.arg, undefined);
	});

	test("offers usage directives at the start of a usage block line", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);
		await vscode.window.showTextDocument(document);

		const lines = document.getText().split("\n");
		const argLine = lines.findIndex((line) => line.includes('arg "<name>"'));
		assert.ok(argLine > 0, "fixture should contain the usage arg line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(argLine, 3),
		);
		assert.ok(
			labels.includes("arg") && labels.includes("flag"),
			`Expected usage directives in completions, got: ${labels.join(", ")}`,
		);
		assert.ok(
			!labels.includes("help") && !labels.includes("choices"),
			`Attributes should not be offered at the start of a line, got: ${labels.join(", ")}`,
		);
	});

	test("offers flag attributes after a flag definition", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		const lines = document.getText().split("\n");
		const flagLine = lines.findIndex((line) =>
			line.includes('flag "-l --loud"'),
		);
		assert.ok(flagLine > 0, "fixture should contain the loud flag line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(flagLine, lines[flagLine]?.length ?? 0),
		);
		assert.ok(
			labels.includes("count") && labels.includes("default"),
			`Expected flag attributes after a flag, got: ${labels.join(", ")}`,
		);
		// `help` is already set on the fixture flag line
		assert.ok(
			!labels.includes("help"),
			`Attributes already used should not be offered again, got: ${labels.join(", ")}`,
		);
		assert.ok(
			!labels.includes("arg") && !labels.includes("flag"),
			`Directives should not be offered after a flag, got: ${labels.join(", ")}`,
		);
	});

	test("provides hover for usage spec keywords", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		const lines = document.getText().split("\n");
		const argLine = lines.findIndex((line) => line.includes('arg "<name>"'));
		assert.ok(argLine > 0, "fixture should contain the usage arg line");

		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				document.uri,
				new vscode.Position(argLine, 1),
			)) ?? [];

		const hoverText = hovers
			.flatMap((hover) => hover.contents)
			.map((content) =>
				typeof content === "string"
					? content
					: (content as { value: string }).value,
			)
			.join("\n");
		assert.ok(
			hoverText.includes("positional argument"),
			`Expected usage hover for "arg", got: ${hoverText}`,
		);
	});

	test("offers choices inside an arg block", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		const lines = document.getText().split("\n");
		const choicesLine = lines.findIndex((line) =>
			line.includes('choices "alice"'),
		);
		assert.ok(choicesLine > 0, "fixture should contain the choices line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(choicesLine, 2),
		);
		assert.ok(
			labels.includes("choices"),
			`Expected choices inside an arg block, got: ${labels.join(", ")}`,
		);
		assert.ok(
			!labels.includes("flag"),
			`Directives should not be offered inside an arg block, got: ${labels.join(", ")}`,
		);
	});

	test("does not offer usage spec completions outside a usage block", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		const lines = document.getText().split("\n");
		const runLine = lines.findIndex((line) =>
			line.includes("Hello from mise test task"),
		);
		assert.ok(runLine >= 0, "fixture should contain the run line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(runLine, 10),
		);
		assert.ok(
			!labels.includes("arg"),
			`Usage directives should not be offered outside usage blocks, got: ${labels.join(", ")}`,
		);
	});

	test("offers usage spec completions after #USAGE in a shell file", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "file-task.sh"),
		);
		await vscode.window.showTextDocument(document);
		assert.equal(document.languageId, "shellscript");

		const lines = document.getText().split("\n");
		const usageLine = lines.findIndex((line) => line.trim() === "#USAGE f");
		assert.ok(usageLine > 0, "fixture should contain the partial #USAGE line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(usageLine, lines[usageLine]?.length ?? 0),
		);
		assert.ok(
			labels.includes("arg") && labels.includes("flag"),
			`Expected usage directives after #USAGE, got: ${labels.join(", ")}`,
		);
	});

	test("offers usage variables in the run block of a task", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		const lines = document.getText().split("\n");
		const varLine = lines.findIndex((line) => line.startsWith("echo $usage_"));
		assert.ok(varLine > 0, "fixture should contain the echo $usage_ line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(varLine, "echo $usage_".length),
		);
		assert.ok(
			labels.includes("usage_name") &&
				labels.includes("usage_greeting") &&
				labels.includes("usage_loud"),
			`Expected usage variables in the run block, got: ${labels.join(", ")}`,
		);
	});

	test("offers usage variables in the body of a shell file task", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "file-task.sh"),
		);

		const lines = document.getText().split("\n");
		const varLine = lines.findIndex((line) => line.startsWith("echo $usage_"));
		assert.ok(varLine > 0, "fixture should contain the echo $usage_ line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(varLine, "echo $usage_".length),
		);
		assert.ok(
			labels.includes("usage_force"),
			`Expected usage variables from #USAGE lines, got: ${labels.join(", ")}`,
		);
	});

	test("offers task configuration completions after #MISE in a shell file", async () => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "file-task.sh"),
		);

		const lines = document.getText().split("\n");
		const miseLine = lines.findIndex((line) => line.startsWith("#MISE"));
		assert.ok(miseLine > 0, "fixture should contain a #MISE line");

		const labels = await getCompletionLabels(
			document.uri,
			new vscode.Position(miseLine, lines[miseLine]?.length ?? 0),
		);
		assert.ok(
			labels.includes("description") && labels.includes("depends"),
			`Expected task configuration keys after #MISE, got: ${labels.join(", ")}`,
		);
		assert.ok(
			!labels.includes("arg"),
			`Usage directives should not be offered after #MISE, got: ${labels.join(", ")}`,
		);
	});
});
