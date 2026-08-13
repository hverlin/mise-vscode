import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { MISE_SELECT_WORKSPACE_FOLDER } from "../../commands";
import { MiseService } from "../../miseService";

/**
 * Multi-root workspace behaviour.
 *
 * The fixture reproduces a common layout: a directory holding the
 * `.code-workspace` file, with some of its subdirectories added as workspace
 * folders. Every level declares a different version of the same tool:
 *
 *   multi-root-workspace/            jq 1.7.1  (parent of the folders, not a folder)
 *   multi-root-workspace/wk1/        jq 1.8.0  (first workspace folder)
 *   multi-root-workspace/wk2/        jq 1.8.1  (second workspace folder)
 *   multi-root-workspace/nested/wk1/ jq 1.7.0  (third folder, called `wk1` too)
 *   global-config.toml               jq 1.6    (stands in for the global config)
 *
 * The extension works on one workspace folder at a time, the one picked with
 * `Mise: select workspace folder`. What it resolves has to come from that
 * folder, never from the directory holding the workspace file and never from
 * the global config.
 */
suite("Multi-root Workspace Test Suite", function () {
	this.timeout(60_000);

	/** ExtensionContext just complete enough for MiseService */
	const createContext = (selectedWorkspaceFolder?: string) =>
		({
			workspaceState: {
				get: (key: string) =>
					key === "selectedWorkspaceFolder"
						? selectedWorkspaceFolder
						: undefined,
				update: async () => {},
			},
			globalState: {
				get: (_key: string, fallback?: unknown) => fallback,
				update: async () => {},
			},
			subscriptions: [],
		}) as unknown as vscode.ExtensionContext;

	const createService = async (selectedWorkspaceFolder?: string) => {
		const miseService = new MiseService(createContext(selectedWorkspaceFolder));
		await miseService.initializeMisePath();
		assert.ok(
			miseService.hasValidMiseBinPath,
			"mise should be available in PATH",
		);
		return miseService;
	};

	const jqVersionOf = async (miseService: MiseService) => {
		const tools = await miseService.getCurrentTools({ useCache: false });
		const jqTools = tools.filter((tool) => tool.name === "jq");
		assert.equal(
			jqTools.length,
			1,
			`Expected a single active jq, got ${JSON.stringify(jqTools)}`,
		);
		return jqTools[0]?.requested_version;
	};

	/** Workspace folder at `relativePath` of the directory holding the workspace file */
	const folderPath = (relativePath: string) => {
		const workspaceFile = vscode.workspace.workspaceFile;
		assert.ok(workspaceFile, "The fixture should open a .code-workspace file");
		const expected = path.join(
			path.dirname(workspaceFile.fsPath),
			...relativePath.split("/"),
		);

		const folder = vscode.workspace.workspaceFolders?.find(
			(f) => f.uri.fsPath === expected,
		);
		assert.ok(folder, `Workspace folder ${relativePath} should exist`);
		return folder.uri.fsPath;
	};

	const selectFolder = (relativePath: string) =>
		vscode.commands.executeCommand(
			MISE_SELECT_WORKSPACE_FOLDER,
			vscode.Uri.file(folderPath(relativePath)),
		);

	const miseTaskNames = async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });
		return tasks.map((task) => task.name);
	};

	/** The reload the select command triggers is asynchronous */
	const waitForTask = async (taskName: string) => {
		const deadline = Date.now() + 20_000;
		let names: string[] = [];
		while (Date.now() < deadline) {
			names = await miseTaskNames();
			if (names.includes(taskName)) {
				return names;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		assert.fail(
			`Task ${taskName} never showed up, last saw: ${names.join(", ")}`,
		);
	};

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "The extension should be installed");
		await extension.activate();
	});

	teardown(async () => {
		// leave the selection on the first folder for the next test
		await selectFolder("wk1");
	});

	test("opens the fixture as a multi-root workspace", () => {
		assert.deepEqual(
			vscode.workspace.workspaceFolders?.map((folder) => folder.name),
			["wk1", "wk2", "wk1"],
		);
	});

	test("resolves tools from the first workspace folder, not from the directory holding the workspace file", async () => {
		const miseService = await createService();

		assert.equal(
			miseService.getCurrentWorkspaceFolderPath(),
			folderPath("wk1"),
			"The first workspace folder is the default one",
		);
		assert.equal(await jqVersionOf(miseService), "1.8.0");
	});

	test("resolves tools from the selected workspace folder", async () => {
		const miseService = await createService(folderPath("wk2"));

		assert.equal(
			miseService.getCurrentWorkspaceFolderPath(),
			folderPath("wk2"),
		);
		assert.equal(await jqVersionOf(miseService), "1.8.1");
	});

	test("selects the folder that was picked when two folders share a name", async () => {
		const miseService = await createService(folderPath("nested/wk1"));

		assert.equal(
			miseService.getCurrentWorkspaceFolderPath(),
			folderPath("nested/wk1"),
		);
		assert.equal(await jqVersionOf(miseService), "1.7.0");
	});

	test("still honours a selection stored by name by older versions", async () => {
		// before 1.23 the selection was stored as a folder name, not a path
		const miseService = await createService("wk2");

		assert.equal(
			miseService.getCurrentWorkspaceFolderPath(),
			folderPath("wk2"),
		);
		assert.equal(await jqVersionOf(miseService), "1.8.1");
	});

	test("falls back to the first folder when the selected one is gone", async () => {
		const miseService = await createService("/removed/folder");

		assert.equal(
			miseService.getCurrentWorkspaceFolderPath(),
			folderPath("wk1"),
		);
		assert.equal(await jqVersionOf(miseService), "1.8.0");
	});

	test("resolves the config files of the selected workspace folder", async () => {
		const miseService = await createService(folderPath("wk2"));

		const configFiles = await miseService.getMiseConfigFiles();
		const paths = configFiles.map((file) => file.path);
		assert.ok(
			paths.includes(path.join(folderPath("wk2"), "mise.toml")),
			`Expected wk2/mise.toml in ${paths.join(", ")}`,
		);
		assert.ok(
			!paths.includes(path.join(folderPath("wk1"), "mise.toml")),
			`wk1/mise.toml should not be part of the wk2 config chain: ${paths.join(", ")}`,
		);
	});

	test("exposes the tasks of the selected workspace folder to vscode", async () => {
		const initialTasks = await waitForTask("wk1-task");
		assert.ok(
			!initialTasks.includes("wk2-task"),
			`Only the tasks of the selected folder should show up, got: ${initialTasks.join(", ")}`,
		);

		await selectFolder("wk2");

		const tasksAfterSwitch = await waitForTask("wk2-task");
		assert.ok(
			!tasksAfterSwitch.includes("wk1-task"),
			`Switching folders should switch the tasks, got: ${tasksAfterSwitch.join(", ")}`,
		);
	});

	test("removes the env vars of the previous folder when switching", async () => {
		const waitForEnv = async (
			name: string,
			expected: string | undefined,
		): Promise<void> => {
			const deadline = Date.now() + 20_000;
			while (Date.now() < deadline) {
				if (process.env[name] === expected) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			assert.equal(
				process.env[name],
				expected,
				`${name} should settle to ${expected}`,
			);
		};

		await selectFolder("wk1");
		await waitForEnv("WHICH_FOLDER", "wk1");
		await waitForEnv("WK1_ONLY", "1");

		await selectFolder("wk2");
		await waitForEnv("WHICH_FOLDER", "wk2");
		// gone entirely: assigning undefined would leave the string
		// "undefined" behind, which tools spawned by other extensions then
		// read as a value
		await waitForEnv("WK1_ONLY", undefined);
	});

	test("switches to a folder whose name collides with another one", async () => {
		await selectFolder("nested/wk1");

		const tasks = await waitForTask("nested-wk1-task");
		assert.ok(
			!tasks.includes("wk1-task"),
			`Expected the tasks of nested/wk1, got: ${tasks.join(", ")}`,
		);
	});
});
