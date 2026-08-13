import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
	MISE_CONFIGURE_ALL_SDK_PATHS,
	MISE_SELECT_WORKSPACE_FOLDER,
} from "../../commands";

const execFileAsync = promisify(execFile);

/**
 * Window-scoped settings in a multi-root workspace. `shellformat.path` cannot
 * hold a folder value, so per-folder configuration cannot express "this
 * folder's shfmt": the folder picked with `Mise: select workspace folder`
 * decides the value, written workspace-wide as it was before folder scoping.
 *
 * The fixture declares shfmt in wk2 only, which is not the default folder, so
 * the two halves of that rule are observable: nothing is written while wk1 is
 * selected, and selecting wk2 writes its shfmt.
 */
suite("Multi-root Window-scoped Settings Test Suite", function () {
	this.timeout(120_000);

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

	const inspectShfmtPath = () =>
		vscode.workspace
			.getConfiguration("shellformat", folderUri("wk2"))
			.inspect<string>("path");

	const clearShfmtPath = () =>
		vscode.workspace
			.getConfiguration("shellformat")
			.update("path", undefined, vscode.ConfigurationTarget.Workspace);

	suiteSetup(async () => {
		assert.ok(
			vscode.extensions.getExtension("foxundermoon.shell-format"),
			"The shell-format extension has to be installed",
		);

		await execFileAsync("mise", ["install"], {
			cwd: folderUri("wk2").fsPath,
		});

		// shell-format is not supported natively: declare it the way the
		// custom-extensions suite does
		await vscode.workspace.getConfiguration("mise").update(
			"customBinaryExtensions",
			[
				{
					binName: "shfmt",
					extensionId: "foxundermoon.shell-format",
					toolSources: ["shfmt"],
					vscodeSetting: { key: "shellformat.path" },
				},
			],
			vscode.ConfigurationTarget.Global,
		);
	});

	suiteTeardown(async () => {
		await vscode.workspace
			.getConfiguration("mise")
			.update(
				"customBinaryExtensions",
				undefined,
				vscode.ConfigurationTarget.Global,
			);
		await clearShfmtPath();
		await selectFolder("wk1");
	});

	setup(async () => {
		await clearShfmtPath();
	});

	test("does not write a window-scoped setting from a folder that is not selected", async () => {
		await selectFolder("wk1");

		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		const inspection = inspectShfmtPath();
		assert.equal(
			inspection?.workspaceValue,
			undefined,
			"Only the selected folder may decide a window-scoped setting",
		);
		assert.equal(
			inspection?.workspaceFolderValue,
			undefined,
			"shellformat.path cannot hold a folder value",
		);
	});

	test("writes a window-scoped setting from the selected folder, workspace-wide", async () => {
		await selectFolder("wk2");

		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		const inspection = inspectShfmtPath();
		assert.ok(
			inspection?.workspaceValue?.endsWith("shfmt"),
			`shellformat.path should point to shfmt, got: ${inspection?.workspaceValue}`,
		);
		assert.equal(
			inspection?.workspaceFolderValue,
			undefined,
			"shellformat.path cannot hold a folder value",
		);
	});
});
