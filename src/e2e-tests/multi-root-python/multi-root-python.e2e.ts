import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
	MISE_CONFIGURE_ALL_SDK_PATHS,
	MISE_SELECT_WORKSPACE_FOLDER,
} from "../../commands";

const execFileAsync = promisify(execFile);

const INTERPRETER_PATH = "python.defaultInterpreterPath";
// biome-ignore lint/suspicious/noTemplateCurlyInString: the vscode variable
const WORKSPACE_FOLDER_VARIABLE = "${workspaceFolder}";

/**
 * The python interpreter path in a multi-root workspace
 * (https://github.com/hverlin/mise-vscode/issues/152).
 *
 * The fixture reproduces the layout of the report: one folder is a python
 * project, the others are not, and one of them does not even use mise.
 *
 *   other-app/   a mise project without python, the default workspace folder
 *   python-app/  the only python project, mise activates a venv for it
 *   no-mise/     no mise config at all
 *
 * mise activates a venv for `python-app`, so the interpreter path the
 * extension writes is relative to the folder, `${workspaceFolder}/.venv`.
 * Written workspace-wide, that path resolves against every folder of the
 * window, and the python extension then reports a missing interpreter in each
 * folder that has no venv, which is what the issue describes. It belongs to
 * the settings of the folder declaring python, and to no other folder.
 */
suite("Multi-root Python Interpreter Test Suite", function () {
	// installs a python on a cold cache
	this.timeout(300_000);

	const pythonFolder = "python-app";
	const folderNames = ["other-app", "python-app", "no-mise"] as const;

	const folderUri = (name: string) => {
		const workspaceFile = vscode.workspace.workspaceFile;
		assert.ok(workspaceFile, "The fixture should open a .code-workspace file");
		const expected = path.join(path.dirname(workspaceFile.fsPath), name);

		const folder = vscode.workspace.workspaceFolders?.find(
			(f) => f.uri.fsPath === expected,
		);
		assert.ok(folder, `Workspace folder ${name} should exist`);
		return folder.uri;
	};

	const selectFolder = (name: string) =>
		vscode.commands.executeCommand(
			MISE_SELECT_WORKSPACE_FOLDER,
			vscode.Uri.file(folderUri(name).fsPath),
		);

	const inspectInterpreterPath = (name: string) =>
		vscode.workspace
			.getConfiguration(undefined, folderUri(name))
			.inspect<string>(INTERPRETER_PATH);

	/** The interpreter path with `${workspaceFolder}` resolved against `name` */
	const resolvedInterpreterPath = (name: string, value: string) =>
		value.replace(WORKSPACE_FOLDER_VARIABLE, folderUri(name).fsPath);

	const clearInterpreterPath = async () => {
		await vscode.workspace
			.getConfiguration()
			.update(
				INTERPRETER_PATH,
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);

		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			await vscode.workspace
				.getConfiguration(undefined, folder.uri)
				.update(
					INTERPRETER_PATH,
					undefined,
					vscode.ConfigurationTarget.WorkspaceFolder,
				)
				// a clear of a folder value vscode refuses is a no-op
				.then(undefined, () => {});
		}
	};

	suiteSetup(async () => {
		assert.ok(
			vscode.extensions.getExtension("ms-python.python"),
			"The python extension has to be installed for mise to configure it",
		);
		assert.deepEqual(
			vscode.workspace.workspaceFolders?.map((folder) => folder.name),
			[...folderNames],
		);

		const pythonFolderPath = folderUri(pythonFolder).fsPath;
		// the mise environment of the suite comes from the extension host
		await execFileAsync("mise", ["install"], {
			cwd: pythonFolderPath,
			maxBuffer: 32 * 1024 * 1024,
		});
		// mise creates the venv the first time the environment is evaluated,
		// once the python it needs is installed
		await execFileAsync("mise", ["env", "--json"], { cwd: pythonFolderPath });
		assert.ok(
			existsSync(path.join(pythonFolderPath, ".venv")),
			`mise should have created the venv of ${pythonFolder}`,
		);
	});

	suiteTeardown(async () => {
		await clearInterpreterPath();
		await selectFolder("other-app");
	});

	setup(async () => {
		await clearInterpreterPath();
		// the folder declaring python is not the selected one
		await selectFolder("other-app");
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
	});

	test("writes the interpreter path to the folder that declares python", () => {
		const value = inspectInterpreterPath(pythonFolder)?.workspaceFolderValue;
		assert.ok(
			value,
			`${INTERPRETER_PATH} should be configured for ${pythonFolder}`,
		);
		assert.ok(
			value.startsWith(WORKSPACE_FOLDER_VARIABLE),
			`The venv path should be relative to its folder, got ${value}`,
		);
		assert.ok(
			existsSync(resolvedInterpreterPath(pythonFolder, value)),
			`${INTERPRETER_PATH} should point at the venv of ${pythonFolder}, got ${value}`,
		);
	});

	test("never writes the interpreter path workspace-wide", () => {
		assert.equal(
			inspectInterpreterPath(pythonFolder)?.workspaceValue,
			undefined,
			"A folder-relative interpreter path applies to one folder only",
		);

		const workspaceFile = vscode.workspace.workspaceFile;
		assert.ok(workspaceFile);
		assert.ok(
			!readFileSync(workspaceFile.fsPath, "utf8").includes(INTERPRETER_PATH),
			"The .code-workspace file should be left alone",
		);
	});

	test("leaves the folders without python alone", () => {
		for (const folder of folderNames.filter((name) => name !== pythonFolder)) {
			const inspection = inspectInterpreterPath(folder);
			assert.equal(
				inspection?.workspaceFolderValue,
				undefined,
				`${folder} has no python: nothing should be written for it`,
			);
			assert.equal(
				inspection?.workspaceValue,
				undefined,
				`${folder} should not inherit the interpreter of another folder`,
			);
			assert.equal(
				vscode.workspace
					.getConfiguration(undefined, folderUri(folder))
					.get<string>(INTERPRETER_PATH),
				inspection?.defaultValue,
				`${folder} should keep the default interpreter of the python extension`,
			);
		}
	});

	test("keeps the interpreter path folder-scoped when its folder is the selected one", async () => {
		await selectFolder(pythonFolder);
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		const inspection = inspectInterpreterPath(pythonFolder);
		assert.ok(
			inspection?.workspaceFolderValue,
			`${INTERPRETER_PATH} should still be configured for ${pythonFolder}`,
		);
		assert.equal(
			inspection?.workspaceValue,
			undefined,
			"Selecting the folder should not spread its interpreter to the window",
		);
		assert.equal(
			inspectInterpreterPath("other-app")?.workspaceFolderValue,
			undefined,
			"other-app has no python, whichever folder is selected",
		);
	});
});
