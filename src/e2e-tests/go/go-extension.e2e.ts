import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { MISE_CONFIGURE_ALL_SDK_PATHS } from "../../commands";

const execFileAsync = promisify(execFile);

/**
 * The go extension in a normal single-folder workspace, end to end: the
 * project pins go 1.25.0 while the global config pins 1.24.0. The extension
 * has to configure the project toolchain, and the tests of the project have
 * to run with it. The fixture test asserts `runtime.Version()` itself, so a
 * wrong toolchain fails the build the way a version mismatch does.
 */
suite("Go Extension Single-root Test Suite", function () {
	// installs a go toolchain and compiles the stdlib on a cold cache
	this.timeout(600_000);

	let workspaceRoot: string;

	const goSettings = () => {
		const config = vscode.workspace.getConfiguration("go");
		return {
			goroot: config.get<string>("goroot"),
			gorootInspection: config.inspect<string>("goroot"),
			goBin: config.get<Record<string, string>>("alternateTools")?.go,
			alternateToolsInspection:
				config.inspect<Record<string, string>>("alternateTools"),
		};
	};

	const clearGoSettings = async () => {
		const config = vscode.workspace.getConfiguration("go");
		for (const key of ["goroot", "alternateTools"]) {
			await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
		}
	};

	/** Run the tests of the fixture with `goBin`, like the test run button does */
	const runProjectTests = async (goBin: string) => {
		const { stdout } = await execFileAsync(
			goBin,
			["test", "-run", "^TestToolchainVersion$", "./..."],
			{ cwd: workspaceRoot },
		);
		assert.match(
			stdout,
			/ok\s+example\.com\/fixture\/demo/,
			`Expected the fixture tests to pass, got: ${stdout}`,
		);
	};

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		const goExtension = vscode.extensions.getExtension("golang.go");
		assert.ok(
			goExtension,
			"The go extension has to be installed for mise to configure it",
		);

		await execFileAsync("mise", ["install"], { cwd: workspaceRoot });
		await clearGoSettings();
	});

	suiteTeardown(async () => {
		await clearGoSettings();
	});

	setup(async () => {
		await clearGoSettings();
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
	});

	test("configures the go extension with workspace-wide settings", () => {
		const { goBin, goroot, alternateToolsInspection } = goSettings();

		assert.ok(goBin, "go.alternateTools.go should be configured");
		assert.ok(goBin.includes("shims"), `Expected a shim, got ${goBin}`);
		assert.equal(goroot, undefined, "goroot is not pinned when using shims");

		// a single-folder window keeps plain workspace settings, no folder values
		assert.ok(alternateToolsInspection?.workspaceValue?.go);
		assert.equal(
			alternateToolsInspection?.workspaceFolderValue,
			undefined,
			"No folder-scoped value should be written in a single-folder window",
		);
	});

	test("the project tests run with the pinned toolchain", async () => {
		const { goBin } = goSettings();
		assert.ok(goBin, "go.alternateTools.go should be configured");

		const { stdout } = await execFileAsync(goBin, ["version"], {
			cwd: workspaceRoot,
		});
		assert.match(
			stdout,
			/go1\.25\.0/,
			`The configured go should be the project one, not the global one: ${stdout}`,
		);

		await runProjectTests(goBin);
	});

	test("the project tests run with the pinned toolchain when shims are off", async () => {
		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		await miseConfiguration.update(
			"configureExtensionsUseShims",
			false,
			vscode.ConfigurationTarget.Workspace,
		);

		try {
			await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

			const { goBin, goroot } = goSettings();
			assert.ok(goBin, "go.alternateTools.go should be configured");
			assert.ok(
				!goBin.includes("shims"),
				`Expected an install path, got ${goBin}`,
			);
			assert.ok(goroot, "goroot should be pinned when shims are off");
			assert.ok(
				goroot.includes("1.25.0"),
				`goroot should be the project toolchain, got ${goroot}`,
			);

			await runProjectTests(goBin);
		} finally {
			await miseConfiguration.update(
				"configureExtensionsUseShims",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
	});
});
