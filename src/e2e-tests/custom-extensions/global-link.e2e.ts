import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A folder setting points at mise's `global` link (mise 2026.10.8+) when the
// version comes from global config, so it follows `mise use -g`. A version the
// project pins keeps its install path, even when global config selects it too.
suite("Custom folder extensions (global link)", function () {
	this.timeout(120_000);

	let workspaceRoot: string;
	let miseTomlPath: string;
	let globalConfigPath: string;
	let originalGlobalConfig: string;
	let originalMiseToml: string;

	const setTools = async ({
		project,
		global,
	}: {
		project: string;
		global: string;
	}) => {
		await writeFile(miseTomlPath, `[tools]\n${project}\n`);
		await writeFile(globalConfigPath, `[tools]\n${global}\n`);
		// installing also moves the `global` link
		await execFileAsync("mise", ["install"], { cwd: workspaceRoot });
		// let the file-watcher reload settle and the 2s command cache expire
		await sleep(3_000);
	};

	const getConfiguredShfmtFolder = () =>
		vscode.workspace.getConfiguration("shellformat").inspect<string>("path")
			?.workspaceValue;

	const clearShfmtFolder = () =>
		vscode.workspace
			.getConfiguration("shellformat")
			.update("path", undefined, vscode.ConfigurationTarget.Workspace);

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		miseTomlPath = path.join(workspaceRoot, "mise.toml");
		globalConfigPath = process.env.MISE_GLOBAL_CONFIG_FILE ?? "";
		assert.ok(globalConfigPath, "the suite sets MISE_GLOBAL_CONFIG_FILE");
		originalGlobalConfig = await readFile(globalConfigPath, "utf8");
		originalMiseToml = await readFile(miseTomlPath, "utf8");

		await vscode.workspace.getConfiguration("mise").update(
			"customFolderExtensions",
			[
				{
					extensionId: "foxundermoon.shell-format",
					toolSources: ["shfmt"],
					vscodeSetting: { key: "shellformat.path" },
					folderName: "shfmt",
				},
			],
			vscode.ConfigurationTarget.Global,
		);
	});

	suiteTeardown(async () => {
		await writeFile(globalConfigPath, originalGlobalConfig);
		await writeFile(miseTomlPath, originalMiseToml);
		await vscode.workspace
			.getConfiguration("mise")
			.update(
				"customFolderExtensions",
				undefined,
				vscode.ConfigurationTarget.Global,
			);
		await clearShfmtFolder();
	});

	setup(async () => {
		await clearShfmtFolder();
	});

	test("a version from global config is written as the global link", async () => {
		await setTools({ project: "", global: 'shfmt = "3.13.1"' });

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		const { stdout } = await execFileAsync("mise", ["where", "shfmt"], {
			cwd: workspaceRoot,
		});
		assert.equal(
			getConfiguredShfmtFolder(),
			path.join(path.dirname(stdout.trim()), "global"),
		);
	});

	test("a version the project pins keeps its install path", async () => {
		await setTools({
			project: 'shfmt = "3.13.1"',
			global: 'shfmt = "3.13.1"',
		});

		await vscode.commands.executeCommand("mise.configureAllSdkPaths");

		const { stdout } = await execFileAsync("mise", ["where", "shfmt"], {
			cwd: workspaceRoot,
		});
		assert.equal(getConfiguredShfmtFolder(), stdout.trim());
	});
});
