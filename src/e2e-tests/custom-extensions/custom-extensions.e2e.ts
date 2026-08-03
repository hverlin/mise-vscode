import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// `toolSources` values are matched against the tool
// names reported by `mise ls --json` AND their mise registry equivalents
// (short name <-> backend source). shfmt is aqua:mvdan/sh in the registry, so
// either spelling matches regardless of how the tool is declared in mise.toml.
suite("Custom binary extensions (toolSources matching)", function () {
	this.timeout(120_000);

	let workspaceRoot: string;
	let miseTomlPath: string;

	const setTools = async (toolsToml: string) => {
		await writeFile(miseTomlPath, `[tools]\n${toolsToml}\n`);
		await execFileAsync("mise", ["install"], { cwd: workspaceRoot });
		// let the file-watcher reload settle and the 2s command cache expire
		await sleep(3_000);
	};

	const setToolSources = (toolSources: string[]) =>
		vscode.workspace.getConfiguration("mise").update(
			"customBinaryExtensions",
			[
				{
					binName: "shfmt",
					extensionId: "foxundermoon.shell-format",
					toolSources,
					vscodeSetting: { key: "shellformat.path" },
				},
			],
			vscode.ConfigurationTarget.Global,
		);

	const getConfiguredShfmtPath = () =>
		vscode.workspace.getConfiguration("shellformat").inspect<string>("path")
			?.workspaceValue;

	const clearShfmtPath = () =>
		vscode.workspace
			.getConfiguration("shellformat")
			.update("path", undefined, vscode.ConfigurationTarget.Workspace);

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		miseTomlPath = path.join(workspaceRoot, "mise.toml");

		await setTools('shfmt = "3.13.1"');
	});

	suiteTeardown(async () => {
		await writeFile(miseTomlPath, '[tools]\nshfmt = "3.13.1"\n');
		await vscode.workspace
			.getConfiguration("mise")
			.update(
				"customBinaryExtensions",
				undefined,
				vscode.ConfigurationTarget.Global,
			);
		await clearShfmtPath();
	});

	setup(async () => {
		await clearShfmtPath();
	});

	test("toolSources matching the short name configures the extension", async () => {
		await setToolSources(["shfmt"]);

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		const shfmtPath = getConfiguredShfmtPath();
		assert.ok(shfmtPath, "shellformat.path should be configured");
		assert.ok(
			shfmtPath.endsWith("shfmt"),
			`shellformat.path should point to shfmt, got: ${shfmtPath}`,
		);
	});

	test("listing both spellings works whichever one mise.toml uses", async () => {
		await setToolSources(["shfmt", "aqua:mvdan/sh"]);

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		assert.ok(
			getConfiguredShfmtPath(),
			"shellformat.path should be configured when toolSources lists both the short name and the backend source",
		);
	});

	test("a backend source matches a tool declared by its short name", async () => {
		await setToolSources(["aqua:mvdan/sh"]);

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		assert.ok(
			getConfiguredShfmtPath(),
			"a tool declared as `shfmt` should match toolSources [aqua:mvdan/sh] via the registry (issue #192)",
		);
	});

	test("toolSources matching a backend-source declaration configures the extension", async () => {
		await setTools('"aqua:mvdan/sh" = "3.13.1"');
		await setToolSources(["aqua:mvdan/sh"]);

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		const shfmtPath = getConfiguredShfmtPath();
		assert.ok(
			shfmtPath,
			"shellformat.path should be configured when mise.toml declares the tool by its backend source",
		);
	});

	test("a short name matches a tool declared by its backend source", async () => {
		await setTools('"aqua:mvdan/sh" = "3.13.1"');
		await setToolSources(["shfmt"]);

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		assert.ok(
			getConfiguredShfmtPath(),
			"a tool declared as `aqua:mvdan/sh` should match toolSources [shfmt] via the registry",
		);
	});
});
