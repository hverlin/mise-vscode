import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/** A token of the TextMate grammars, as VS Code's colorization tests read them */
type SyntaxToken = { c: string; t: string };

/**
 * Highlighting of task scripts and Tera in TOML strings, whichever TOML grammar
 * is active: ours, or the one of another extension such as Tombi, when it wins
 * the extension load order. A bash `${#...}` must not start a Tera comment that
 * runs over the rest of the file
 * (https://github.com/hverlin/mise-vscode/issues/358)
 */
export function teraHighlightingSuite(tomlGrammar: "mise-vscode" | "other") {
	suite(`Tera Highlighting Test Suite (${tomlGrammar} TOML grammar)`, function () {
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
				assert.doesNotMatch(
					token.t,
					/string|shell|tera/,
					`${header} is a table`,
				);
			}
		};

		/** Asserts that the `{{` of the line containing `text` starts Tera */
		const assertTeraAt = (text: string) => {
			const opening = tokensOf(text).find((token) => token.c.includes("{{"));
			assert.ok(opening, `no {{ on the line of "${text}"`);
			assert.match(opening.t, /punctuation\.section\.embedded\.begin\.tera/);
			assert.doesNotMatch(opening.t, /comment\.block\.tera/);
		};

		// raw blocks are not modelled: their content is highlighted as the rest of
		// the template, so a bash length expansion or an unclosed {{ must not start
		// Tera on their own
		test("a bash length expansion is not a Tera comment", () => {
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
			for (const token of tokensOf("-f ref={{").slice(0, 3)) {
				assert.match(token.t, /\.shell/);
			}
		});

		test("an unclosed comment in a shell script does not run over the file", () => {
			assertHeader("[tasks.after-shell-unterminated]");
			assertTeraAt("usage.after_shell");
		});

		test("an unclosed {{ is not Tera", () => {
			for (const token of tokensOf("echo a{{b,c},d}")) {
				assert.doesNotMatch(token.t, /meta\.embedded\.block\.tera/);
			}
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

		/** Asserts that the line containing `text` has a scope matching `scope` */
		const assertScope = (text: string, scope: RegExp) => {
			assert.ok(
				tokensOf(text).some((token) => scope.test(token.t)),
				`the line of "${text}" has ${scope}`,
			);
		};

		test("a Python script is Python, past its docstring", () => {
			assertScope("import json", /keyword\.control\.import\.python/);
			assertTeraExpressions('name = "{{ usage.name }}"', 1);
			assertScope("print(json.dumps", /\.python/);
			assertTeraExpressions("print(json.dumps", 1);
			assertHeader("[tasks.after-python]");
		});

		test("node, deno and bun scripts are JavaScript", () => {
			assertScope("class Counter {#count", /meta\.class\.ts/);
			assert.ok(!tokensOf("class Counter {#count").some(isComment));
			assertTeraExpressions("console.log(label", 1);
			assertScope("console.log(label", /\.ts/);
			assertHeader("[tasks.after-node]");
			assertScope("Deno.env.get", /\.ts/);
			assertTeraExpressions("Deno.env.get", 1);
			assertScope("Bun.spawnSync", /\.ts/);
			assertTeraExpressions("Bun.spawnSync", 1);
		});

		test("a Ruby script is Ruby", () => {
			assertScope("config = {a: {b: 1}}", /\.ruby/);
			for (const token of tokensOf("#{name} #{config}")) {
				assert.doesNotMatch(token.t, /\.tera\b/);
			}
			assertHeader("[tasks.after-ruby]");
		});

		test("a sh script is shell, with bash length expansions", () => {
			assertScope('echo "{{ usage.name }}"', /\.shell/);
			assertTeraExpressions('echo "{{ usage.name }}"', 1);
			assert.ok(!tokensOf("#HOME}").some(isComment));
			assertHeader("[tasks.after-sh]");
		});

		/** Asserts that no token of the line containing `text` matches `scope` */
		const assertNoScope = (text: string, scope: RegExp) => {
			for (const token of tokensOf(text)) {
				assert.doesNotMatch(token.t, scope, `"${token.c}" of "${text}"`);
			}
		};

		test("a script ends at its closing quotes, before more TOML", () => {
			assertTeraExpressions('print("{{ usage.array }}")', 1);
			assertNoScope('"echo {{ usage.done }}"]', /\.python|script/);
			assertTeraExpressions("usage.done", 1);
			assertHeader("[tasks.after-array-script]");
			assertNoScope('description = "x" }', /\.ts|script/);
			assertNoScope("'''] }", /\.shell|script/);
			assertHeader("[tasks.after-inline]");
			assertTeraAt("usage.after_inline");
		});

		test("escaped quotes in a Tera string close it", () => {
			assertTeraExpressions("git rev-parse HEAD", 1);
			assertHeader("[tasks.after-escaped]");
			assertTeraAt("usage.after_escaped");
		});

		test("a shebang in a shell comment or string does not start a script", () => {
			assertNoScope(
				"echo '#!/usr/bin/env bash'",
				/meta\.embedded\.block\.script/,
			);
			assertNoScope("usage.after_shebang", /meta\.embedded\.block\.script/);
			assertScope("usage.after_shebang", /\.shell/);
			assertTeraExpressions("usage.after_shebang", 1);
		});

		test("an unclosed comment does not run over the file", () => {
			assertHeader("[tasks.after]");
			assertTeraAt("{{ usage.after }}");
		});

		test("the expected TOML grammar is active", () => {
			// Tombi's grammar scopes table headers, ours does not
			const header = tokensOf("[tasks.since]");
			const tombi = header.some((token) => token.t.includes("meta.table.toml"));
			assert.strictEqual(tombi, tomlGrammar === "other");
		});

		test("a one-line run string is a shell script", () => {
			assertScope(
				'run = "echo {{ usage.single }}',
				/support\.function\.builtin\.shell/,
			);
			assertTeraExpressions('run = "echo {{ usage.single }}', 1);
			assertScope("run = 'ls -la'", /entity\.name\.command\.shell/);
		});

		test("the scripts of a run array are shell, its task entries are not", () => {
			assertNoScope('{ task = "build" }', /\.shell/);
			assertNoScope("# a comment between scripts", /\.shell/);
			assertScope(
				'"echo {{ usage.array_entry }}"',
				/support\.function\.builtin\.shell/,
			);
			assertTeraExpressions('"echo {{ usage.array_entry }}"', 1);
			assertScope('"""if [ -n "$X" ]', /keyword\.control\.if\.shell/);
			assertScope("echo multi", /support\.function\.builtin\.shell/);
			assertHeader("[tasks.after-run-array]");
			assertTeraAt("usage.after_run_array");
		});

		test("a usage spec is KDL", () => {
			assertScope('flag "--clean" help="Clean"', /\.kdl/);
			assertHeader("[tasks.after-usage]");
		});

		test("the other kind of triple quote does not close a script", () => {
			assertHeader("[tasks.after-other-triple-quote]");
			assertTeraAt("usage.after_other_triple");
		});

		test("a closer written as four quotes keeps its first quote", () => {
			assertHeader("[tasks.after-four-quotes]");
			assertTeraAt("usage.after_four_quotes");
		});

		test("a dotted run key is a shell script", () => {
			assertScope('dotted.run = "echo', /support\.function\.builtin\.shell/);
			assertTeraExpressions('dotted.run = "echo', 1);
		});

		test("a nested inline table in a run array closes in order", () => {
			assertScope('nested = { run = ["ls"', /entity\.name\.command\.shell/);
			assertHeader("[tasks.after-dotted]");
			assertTeraAt("usage.after_dotted");
		});

		test("a TOML string that is not a script has Tera but no shell", () => {
			assertNoScope("#plain[@]", /\.shell|comment\.block\.tera/);
			assertTeraExpressions("{{ usage.plain }}", 1);
			assertHeader("[tasks.after-plain]");
		});
	});
}
