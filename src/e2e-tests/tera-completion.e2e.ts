import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Completion and hover of the Tera templates of mise
 * (https://mise.jdx.dev/templates.html), from what precedes the cursor
 */
suite("Tera Completion Test Suite", function () {
	this.timeout(30_000);

	let document: vscode.TextDocument;

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.templates.toml"),
		);
	});

	/** The position right after `text`, on the line of `key` */
	const after = (key: string, text: string): vscode.Position => {
		for (let line = 0; line < document.lineCount; line++) {
			const lineText = document.lineAt(line).text;
			if (lineText.startsWith(`${key} =`)) {
				const character = lineText.indexOf(text);
				assert.ok(character !== -1, `"${text}" not found on the ${key} line`);
				return new vscode.Position(line, character + text.length);
			}
		}
		assert.fail(`${key} not found in the fixture`);
	};

	const labelsAt = async (position: vscode.Position, trigger?: string) => {
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				"vscode.executeCompletionItemProvider",
				document.uri,
				position,
				trigger,
			);
		return completions.items.map((item) =>
			typeof item.label === "string" ? item.label : item.label.label,
		);
	};

	const hoverAt = async (position: vscode.Position) => {
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			"vscode.executeHoverProvider",
			document.uri,
			position,
		);
		return hovers
			.flatMap((hover) => hover.contents)
			.map((content) => (typeof content === "string" ? content : content.value))
			.join("\n");
	};

	test("completes the filters after a pipe, without the deprecated ones", async () => {
		const labels = await labelsAt(after("FILTER", "| "));
		assert.ok(labels.includes("str"), "str is suggested");
		assert.ok(labels.includes("escape_html"), "escape_html is suggested");
		assert.ok(!labels.includes("as_str"), "as_str is deprecated");
		assert.ok(!labels.includes("read_json"), "functions are not filters");
	});

	test("completes the tests after is, and is not", async () => {
		const labels = await labelsAt(after("TEST", "is "), " ");
		assert.ok(labels.includes("starting_with"), "starting_with is a test");
		assert.ok(labels.includes("not"), "is not");
		assert.ok(!labels.includes("lower"), "filters are not tests");

		const negated = await labelsAt(after("NOT_TEST", "is not "), " ");
		assert.ok(negated.includes("defined"), "defined is a test");
		assert.ok(!negated.includes("not"), "not is already there");
	});

	test("completes variables, functions and keywords in an expression", async () => {
		const labels = await labelsAt(after("EXPRESSION", "{{ "));
		for (const label of [
			"read_json",
			"read_yaml",
			"read_toml",
			"libc",
			"avx2",
			"system_brew_prefix",
			"config_source",
			"set_global",
		]) {
			assert.ok(labels.includes(label), `${label} is suggested`);
		}
		for (const label of ["macro", "import", "as_str"]) {
			assert.ok(!labels.includes(label), `${label} is not in Tera 2`);
		}
	});

	test("a space only completes the tests", async () => {
		const labels = await labelsAt(after("EXPRESSION", "{{ "), " ");
		assert.ok(!labels.includes("read_json"), "nothing after a space");
	});

	test("explains a function, and a deprecated filter", async () => {
		const readJson = await hoverAt(after("FUNCTION", "{{ read_"));
		assert.match(readJson, /Parses a JSON file/);

		const asStr = await hoverAt(after("DEPRECATED", "| as_"));
		assert.match(asStr, /deprecated: use `str` instead/);
	});

	test("explains a test, in a tag", async () => {
		const defined = await hoverAt(after("HOVER_TEST", "is def"));
		assert.match(defined, /The variable is defined/);
	});
});
