import * as assert from "node:assert";
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { expandPath } from "../../utils/fileUtils";

/**
 * The workspace is opened through a symlink, like a project under /tmp on
 * macOS (a symlink to /private/tmp). mise reports the real path of the config
 * files, which the extension must translate to the path vscode opened: it
 * would not recognise its own documents otherwise.
 */
suite("Symlinked Workspace Test Suite", function () {
	this.timeout(60_000);

	let workspaceRoot: string;
	let configPath: string;
	let miseService: MiseService;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		assert.notEqual(
			await realpath(workspaceRoot),
			workspaceRoot,
			"the workspace should be opened through a symlink",
		);
		configPath = path.join(workspaceRoot, "mise.toml");

		miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		assert.ok(
			miseService.getMiseBinaryPath(),
			"mise binary should be resolved",
		);

		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	test("reports the config file under the path vscode opened", async () => {
		const files = (await miseService.getMiseConfigFiles()).map((file) =>
			expandPath(file.path),
		);

		assert.ok(
			files.includes(expandPath(configPath)),
			`${configPath} should be in ${JSON.stringify(files)}`,
		);
	});

	test("reports the tasks under the path vscode opened", async () => {
		const build = (await miseService.getTasks()).find(
			(task) => task.name === "build",
		);

		assert.equal(build && expandPath(build.source), expandPath(configPath));
	});

	test("shows the task code lenses of the config file", async () => {
		const uri = vscode.Uri.file(configPath);
		await vscode.workspace.openTextDocument(uri);

		const codeLenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
			"vscode.executeCodeLensProvider",
			uri,
		);
		const runTaskArgs = (codeLenses ?? [])
			.filter((lens) => lens.command?.command === "mise.runTask")
			.map((lens) => lens.command?.arguments?.[0]);

		assert.deepEqual(runTaskArgs, ["build"]);
	});
});
