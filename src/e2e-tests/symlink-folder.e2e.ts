import * as assert from "node:assert";
import { mkdir, readlink, rm } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../miseService";

suite("Tool Symlink Folder Test Suite", function () {
	this.timeout(10_000);

	let workspaceRoot: string;
	let miseService: MiseService;
	let targetDir: string;

	// createMiseToolSymlink only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const updateSymLinksFolder = (value: string | undefined) =>
		vscode.workspace
			.getConfiguration("mise")
			.update(
				"configureExtensionsSymLinksFolder",
				value,
				vscode.ConfigurationTarget.Global,
			);

	setup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		miseService = new MiseService(fakeContext);
		targetDir = path.join(workspaceRoot, "fake-tool-install");
		await mkdir(targetDir, { recursive: true });
	});

	teardown(async () => {
		await updateSymLinksFolder(undefined);
		for (const dir of [".vscode", ".custom-ide", "fake-tool-install"]) {
			await rm(path.join(workspaceRoot, dir), { recursive: true, force: true });
		}
	});

	test("createMiseToolSymlink should use the configured symlinks folder", async () => {
		const defaultPath = await miseService.createMiseToolSymlink(
			"my-tool",
			targetDir,
		);

		assert.equal(
			defaultPath,
			// biome-ignore lint/suspicious/noTemplateCurlyInString: expected
			path.join("${workspaceFolder}", ".vscode/mise-tools", "my-tool"),
		);
		assert.equal(
			await readlink(path.join(workspaceRoot, ".vscode/mise-tools/my-tool")),
			targetDir,
		);

		await updateSymLinksFolder(".custom-ide/mise-tools");

		const customPath = await miseService.createMiseToolSymlink(
			"my-tool",
			targetDir,
		);

		assert.equal(
			customPath,
			// biome-ignore lint/suspicious/noTemplateCurlyInString: expected
			path.join("${workspaceFolder}", ".custom-ide/mise-tools", "my-tool"),
		);
		assert.equal(
			await readlink(
				path.join(workspaceRoot, ".custom-ide/mise-tools/my-tool"),
			),
			targetDir,
		);
	});
});
