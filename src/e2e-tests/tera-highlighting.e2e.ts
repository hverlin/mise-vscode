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

	/** Asserts that a task's table header is not inside a string or Tera */
	const assertHeader = (header: string) => {
		for (const token of tokensOf(header)) {
			assert.doesNotMatch(token.t, /string|shell|tera/, `${header} is a table`);
		}
	};

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
		assertHeader("[tasks.since]");
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

	/** The line containing `text`, with the scopes of each of its characters */
	const scopesByCharacter = (text: string) => {
		const line = lines.find((line) => line.text.includes(text));
		assert.ok(line, `no line contains "${text}"`);
		const scopes = line.tokens.flatMap((token) =>
			Array.from(token.c, () => token.t),
		);
		return { line, scopes };
	};

	/**
	 * Asserts that each `{{ ... }}` of the line containing `text` is Tera from
	 * its `{{` to its `}}`, and that what follows it is not
	 */
	const assertTeraExpressions = (text: string, count: number) => {
		const { line, scopes } = scopesByCharacter(text);
		const expressions = [...line.text.matchAll(/\{\{.*?\}\}/g)];
		assert.strictEqual(expressions.length, count, `expressions in "${text}"`);
		for (const { 0: expression, index: start } of expressions) {
			const end = start + expression.length;
			for (let i = start; i < end; i++) {
				assert.match(
					scopes[i] ?? "",
					/meta\.embedded\.block\.tera/,
					`"${line.text[i]}" at ${i} of "${line.text}" is Tera`,
				);
			}
			assert.match(scopes[start] ?? "", /embedded\.begin\.tera/);
			assert.match(scopes[end - 1] ?? "", /embedded\.end\.tera/);
			if (end < line.text.length) {
				assert.doesNotMatch(
					scopes[end] ?? "",
					/meta\.embedded\.block\.tera/,
					`what follows ${expression} is not Tera`,
				);
			}
		}
	};

	test("Tera is highlighted in the arguments of a shell script", () => {
		assertTeraExpressions("-f ref={{", 1);
		assertTeraExpressions("--stage={{", 1);
		assertTeraExpressions("pre{{", 1);
		assertTeraExpressions("sort <", 2);
		assertTeraExpressions(">out-{{", 1);
		assertTeraExpressions("{{ usage.command }}", 1);
		assertTeraExpressions("# Deploying on", 1);
		assertTeraExpressions("<<< {{", 1);
		assertTeraExpressions("<<EOF > {{", 1);
		assertTeraExpressions("{{ usage.body }}", 1);
	});

	test("the script is highlighted as shell", () => {
		// our TOML grammar, not the one of another extension, is the one tested
		for (const token of tokensOf("-f ref={{").slice(0, 3)) {
			assert.match(token.t, /\.shell/);
		}
	});

	test("an unterminated comment ends with its shell script", () => {
		assertHeader("[tasks.after-shell-unterminated]");
		assertTeraAt("usage.after_shell");
	});

	test("a brace expansion in a raw block ends with its script", () => {
		assertHeader("[tasks.after-brace-expansion]");
		assertTeraAt("usage.after_braces");
	});

	test("{{ in a Tera comment does not start an expression", () => {
		const { line, scopes } = scopesByCharacter("{# {{ #}");
		const comment = line.text.indexOf("{# {{ #}");
		for (let i = comment; i < comment + "{# {{ #}".length; i++) {
			assert.match(scopes[i] ?? "", /comment\.block\.tera/);
			assert.doesNotMatch(scopes[i] ?? "", /meta\.embedded\.block\.tera/);
		}
		const expression = line.text.indexOf("{{ usage.after_comment }}");
		for (let i = expression; i < line.text.lastIndexOf("}}") + 2; i++) {
			assert.match(scopes[i] ?? "", /meta\.embedded\.block\.tera/);
		}
	});

	test("an unterminated comment ends with its string", () => {
		assertHeader("[tasks.after]");
		assertTeraAt("usage.after");
	});
});
