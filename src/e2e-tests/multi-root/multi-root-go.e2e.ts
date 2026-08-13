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
 * A multi-root workspace whose folders pin different go versions.
 *
 * What broke for the reporter is a toolchain mixing two versions:
 *
 *   compile: version "go1.23.12" does not match go tool version "go1.26.5"
 *
 * `go.goroot` is an absolute install path, so it names one version for the
 * whole window, while the `go` binary of `go.alternateTools` is a shim that
 * resolves against the directory it runs in. In a workspace whose folders pin
 * different versions the two disagree and every build fails. Whichever folder
 * the extension works on, what it configures has to stay consistent.
 */
suite("Multi-root Go Toolchain Test Suite", function () {
	// installs two go toolchains on a cold cache
	this.timeout(600_000);

	const goVersions = { wk1: "1.24.0", wk2: "1.25.0" };

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

	/** `go version` of a go binary, run from `cwd` so shims resolve there */
	const goVersionOf = async (goBin: string, cwd: string) => {
		const { stdout } = await execFileAsync(goBin, ["version"], { cwd });
		const version = stdout.match(/go(\d+\.\d+(\.\d+)?)/)?.[1];
		assert.ok(version, `Unable to read a version out of: ${stdout}`);
		return version;
	};

	/** The go settings that apply to a workspace folder */
	const goSettingsOf = (folder: vscode.Uri) => {
		const config = vscode.workspace.getConfiguration("go", folder);
		const alternateTools = config.get<Record<string, string>>("alternateTools");
		return {
			goroot: config.get<string>("goroot"),
			goBin: alternateTools?.go,
			goplsBin: alternateTools?.gopls,
		};
	};

	const clearGoSettings = async () => {
		const config = vscode.workspace.getConfiguration("go");
		await config.update(
			"goroot",
			undefined,
			vscode.ConfigurationTarget.Workspace,
		);
		await config.update(
			"alternateTools",
			undefined,
			vscode.ConfigurationTarget.Workspace,
		);

		// the extension writes folder-scoped values in multi-root workspaces
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const folderConfig = vscode.workspace.getConfiguration("go", folder.uri);
			for (const key of ["goroot", "alternateTools"]) {
				await folderConfig
					.update(key, undefined, vscode.ConfigurationTarget.WorkspaceFolder)
					// a clear of a folder value vscode refuses is a no-op
					.then(undefined, () => {});
			}
		}
	};

	suiteSetup(async () => {
		assert.ok(
			vscode.extensions.getExtension("golang.go"),
			"The go extension has to be installed for mise to configure it",
		);

		// the mise environment of the suite comes from the extension host
		for (const folder of ["wk1", "wk2"] as const) {
			await execFileAsync("mise", ["install"], {
				cwd: folderUri(folder).fsPath,
			});
		}

		await clearGoSettings();
	});

	suiteTeardown(async () => {
		await clearGoSettings();
		await vscode.commands.executeCommand(
			MISE_SELECT_WORKSPACE_FOLDER,
			vscode.Uri.file(folderUri("wk1").fsPath),
		);
	});

	setup(async () => {
		await clearGoSettings();
		await vscode.commands.executeCommand(
			MISE_SELECT_WORKSPACE_FOLDER,
			vscode.Uri.file(folderUri("wk1").fsPath),
		);
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
	});

	test("configures the go toolchain of the selected workspace folder", async () => {
		const wk1 = folderUri("wk1");
		const { goBin } = goSettingsOf(wk1);

		assert.ok(goBin, "go.alternateTools.go should be configured");
		assert.equal(await goVersionOf(goBin, wk1.fsPath), goVersions.wk1);
	});

	test("does not pin a goroot when the go binary is a shim", async () => {
		const { goroot, goBin } = goSettingsOf(folderUri("wk1"));

		assert.ok(goBin?.includes("shims"), `Expected a shim, got ${goBin}`);
		assert.equal(
			goroot,
			undefined,
			`A shim resolves per directory, so GOROOT has to come from it, got ${goroot}`,
		);
	});

	test("never pins a goroot that disagrees with the go binary", async () => {
		for (const [folder, pinnedVersion] of Object.entries(goVersions)) {
			const uri = folderUri(folder);
			const { goroot, goBin } = goSettingsOf(uri);
			assert.ok(goBin, `go.alternateTools.go should be configured (${folder})`);

			const binVersion = await goVersionOf(goBin, uri.fsPath);
			if (folder === "wk1") {
				assert.equal(binVersion, pinnedVersion);
			}

			if (!goroot) {
				continue;
			}

			// GOROOT and the go binary have to be the same toolchain, otherwise
			// every build in that folder fails with `compile: version ... does
			// not match go tool version ...`
			const gorootVersion = await goVersionOf(
				path.join(goroot, "bin", "go"),
				uri.fsPath,
			);
			assert.equal(
				gorootVersion,
				binVersion,
				`go.goroot (${goroot}) and the configured go binary (${goBin}) are different toolchains in ${folder}`,
			);
		}
	});

	test("pins the goroot of the go binary when shims are turned off", async () => {
		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		await miseConfiguration.update(
			"configureExtensionsUseShims",
			false,
			vscode.ConfigurationTarget.Workspace,
		);

		try {
			await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

			const wk1 = folderUri("wk1");
			const { goroot, goBin } = goSettingsOf(wk1);
			assert.ok(goBin, "go.alternateTools.go should be configured");
			assert.ok(
				!goBin.includes("shims"),
				`Expected an install path, got ${goBin}`,
			);
			// the binary names one install, so GOROOT may name it too
			assert.ok(goroot, "go.goroot should be pinned when shims are off");
			assert.equal(
				await goVersionOf(path.join(goroot, "bin", "go"), wk1.fsPath),
				goVersions.wk1,
			);
		} finally {
			await miseConfiguration.update(
				"configureExtensionsUseShims",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
	});

	test("gives every folder its own toolchain at the same time", async () => {
		// Before the settings were folder-scoped, the go binary of the selected
		// folder applied to the whole window, so with shims off the other
		// folder built with the wrong toolchain.
		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		await miseConfiguration.update(
			"configureExtensionsUseShims",
			false,
			vscode.ConfigurationTarget.Workspace,
		);

		try {
			await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

			for (const [folder, pinnedVersion] of Object.entries(goVersions)) {
				const uri = folderUri(folder);
				const { goBin, goroot } = goSettingsOf(uri);
				assert.ok(
					goBin,
					`go.alternateTools.go should be configured in ${folder}`,
				);
				assert.equal(
					await goVersionOf(goBin, uri.fsPath),
					pinnedVersion,
					`the go binary of ${folder}`,
				);
				if (goroot) {
					assert.equal(
						await goVersionOf(path.join(goroot, "bin", "go"), uri.fsPath),
						pinnedVersion,
						`the goroot of ${folder}`,
					);
				}
			}
		} finally {
			await miseConfiguration.update(
				"configureExtensionsUseShims",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
	});

	test("keeps the alternateTools entries the user added", async () => {
		const wk1 = folderUri("wk1");
		await vscode.workspace
			.getConfiguration("go", wk1)
			.update(
				"alternateTools",
				{ customTool: "/usr/local/bin/custom" },
				vscode.ConfigurationTarget.WorkspaceFolder,
			);

		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		const alternateTools = vscode.workspace
			.getConfiguration("go", wk1)
			.inspect<Record<string, string>>("alternateTools")?.workspaceFolderValue;
		assert.equal(
			alternateTools?.customTool,
			"/usr/local/bin/custom",
			"The user's own entry should survive a configure run",
		);
		assert.ok(
			alternateTools?.go,
			"The mise entries should be merged in next to it",
		);
	});

	test("removes a goroot an earlier version of the extension pinned", async () => {
		const staleGoRoot = path.join(
			folderUri("wk1").fsPath,
			"..",
			".mise-data",
			"installs",
			"go",
			goVersions.wk1,
		);
		await vscode.workspace
			.getConfiguration("go")
			.update("goroot", staleGoRoot, vscode.ConfigurationTarget.Workspace);

		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		assert.equal(
			goSettingsOf(folderUri("wk1")).goroot,
			undefined,
			"A goroot left over from a previous run should be removed",
		);
	});

	test("keeps a goroot the user set themselves", async () => {
		const userGoRoot = path.join(path.sep, "usr", "local", "go");
		await vscode.workspace
			.getConfiguration("go")
			.update("goroot", userGoRoot, vscode.ConfigurationTarget.Workspace);

		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		assert.equal(
			goSettingsOf(folderUri("wk1")).goroot,
			userGoRoot,
			"A goroot that does not come from mise belongs to the user",
		);
	});

	test("switching the workspace folder switches the go toolchain", async () => {
		const wk2 = folderUri("wk2");
		await vscode.commands.executeCommand(
			MISE_SELECT_WORKSPACE_FOLDER,
			vscode.Uri.file(wk2.fsPath),
		);
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

		const { goBin, goroot } = goSettingsOf(wk2);
		assert.ok(goBin, "go.alternateTools.go should be configured");
		assert.equal(await goVersionOf(goBin, wk2.fsPath), goVersions.wk2);

		if (goroot) {
			assert.equal(
				await goVersionOf(path.join(goroot, "bin", "go"), wk2.fsPath),
				goVersions.wk2,
			);
		}
	});
});
