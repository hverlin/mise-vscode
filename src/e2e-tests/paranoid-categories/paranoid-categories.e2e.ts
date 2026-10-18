import * as assert from "node:assert";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";

const execFileAsync = promisify(execFile);

/**
 * Paranoid mode turned on for some categories only (`MISE_PARANOID=config`,
 * mise 2026.10.14+): mise reports a list instead of `true`, and the config
 * files are still bound to their content.
 */
suite("Paranoid Categories Test Suite", function () {
	this.timeout(60_000);

	let workspaceRoot: string;
	let miseBinaryPath: string;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const mise = (...args: string[]) =>
		execFileAsync(miseBinaryPath, args, { cwd: workspaceRoot });

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		miseBinaryPath = miseService.getMiseBinaryPath() ?? "";
		assert.ok(miseBinaryPath, "mise binary should be resolved");

		const { stdout } = await mise("settings", "get", "paranoid");
		assert.equal(
			stdout.trim(),
			'["config"]',
			"the suite needs a category list",
		);

		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	test("does not trust the config file on activation", async () => {
		const { stdout } = await mise("trust", "--show");
		assert.match(stdout, /mise\.toml: untrusted/);
	});

	test("shows paranoid mode on top of the config file", async () => {
		await mise("trust");
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);

		const deadline = Date.now() + 20_000;
		let titles: (string | undefined)[] = [];
		while (Date.now() < deadline) {
			await vscode.commands.executeCommand("mise.refreshEntry", {
				force: true,
			});
			const lenses =
				(await vscode.commands.executeCommand<vscode.CodeLens[]>(
					"vscode.executeCodeLensProvider",
					document.uri,
				)) ?? [];
			titles = lenses.map((lens) => lens.command?.title);
			if (titles.includes("$(shield) Paranoid mode")) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		assert.ok(
			titles.includes("$(shield) Paranoid mode"),
			`Expected the paranoid mode lens, got: ${titles.join(", ")}`,
		);
	});
});
