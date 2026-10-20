import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/** A token of the TextMate grammars, as VS Code's colorization tests read them */
type SyntaxToken = { c: string; t: string };

/**
 * Tera highlighting in TOML strings: a bash `${#...}` must not start a Tera
 * comment that runs over the rest of the file
 * (https://github.com/hverlin/mise-vscode/issues/358)
 */
suite("Tera Highlighting Test Suite", function () {
	this.timeout(30_000);

	let lines: { text: string; tokens: SyntaxToken[] }[];

	suiteSetup(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		const uri = vscode.Uri.file(
			path.join(workspaceRoot, "tera-highlighting.toml"),
		);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		const tokens = await vscode.commands.executeCommand<SyntaxToken[]>(
			"_workbench.captureSyntaxTokens",
			uri,
		);
		assert.ok(tokens?.length, "the file should be tokenized");

		// the tokens of each line, in order
		let next = 0;
		lines = document
			.getText()
			.split(/\r?\n/)
			.map((text) => {
				const lineTokens: SyntaxToken[] = [];
				let read = "";
				while (read.length < text.length && next < tokens.length) {
					const token = tokens[next++] as SyntaxToken;
					lineTokens.push(token);
					read += token.c;
				}
				assert.strictEqual(read, text, "the tokens should match the line");
				return { text, tokens: lineTokens };
			});
	});

	/** The tokens of the first line that contains `text` */
	const tokensOf = (text: string) => {
		const line = lines.find((line) => line.text.includes(text));
		assert.ok(line, `no line contains "${text}"`);
		return line.tokens;
	};

	const isComment = (token: SyntaxToken) =>
		token.t.includes("comment.block.tera");

	/** Asserts that the `{{` of the line containing `text` starts Tera */
	const assertTeraAt = (text: string) => {
		const opening = tokensOf(text).find((token) => token.c.includes("{{"));
		assert.ok(opening, `no {{ on the line of "${text}"`);
		assert.match(opening.t, /punctuation\.section\.embedded\.begin\.tera/);
		assert.doesNotMatch(opening.t, /comment\.block\.tera/);
	};

	test("a raw block is not a Tera comment", () => {
		for (const text of ["#branch[@]", "choose branch", "endraw"]) {
			assert.deepStrictEqual(
				tokensOf(text)
					.filter(isComment)
					.map((token) => token.c),
				[],
				`the line of "${text}" is not a comment`,
			);
		}
	});

	test("Tera is highlighted after a raw block", () => {
		assertTeraAt("gh workflow run");
	});

	test("the next task is highlighted", () => {
		assert.ok(!tokensOf("[tasks.since]").some(isComment));
		assertTeraAt("usage.since");
	});

	test("a Tera comment is a comment", () => {
		const comment = tokensOf("{# a Tera comment #}").filter(isComment);
		assert.strictEqual(
			comment.map((token) => token.c).join(""),
			"{# a Tera comment #}",
		);
		assertTeraAt("usage.commented");
	});

	test("an unterminated comment ends with its string", () => {
		assert.ok(!tokensOf("[tasks.after]").some(isComment));
		assertTeraAt("usage.after");
	});
});
