import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { isMiseAtLeast } from "../test-utils";

/**
 * The config files of the monorepo projects are checked for unknown and
 * deprecated keys without being open (see crates/agent/mise.toml).
 */
suite("Monorepo Config Diagnostics Test Suite", function () {
	this.timeout(60_000);

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	suiteSetup(async function () {
		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		// `mise config explain` comes with mise 2026.10.14
		if (
			!(await isMiseAtLeast(
				miseService.getMiseBinaryPath() ?? "",
				[2026, 10, 14],
			))
		) {
			this.skip();
		}
		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	test("reports a deprecated key of a project config that is not open", async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		const uri = vscode.Uri.file(
			path.join(root, "crates", "agent", "mise.toml"),
		);
		const deprecations = () =>
			vscode.languages
				.getDiagnostics(uri)
				.filter((diagnostic) => diagnostic.code === "deprecated-key")
				.map((diagnostic) => diagnostic.message);

		const deadline = Date.now() + 30_000;
		while (!deprecations().length && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		assert.deepEqual(deprecations(), [
			"`env_path` is deprecated: use env._.path instead. This will be removed in mise 2027.4.0.",
		]);
		assert.ok(
			!vscode.window.tabGroups.all
				.flatMap((group) => group.tabs)
				.some(
					(tab) =>
						tab.input instanceof vscode.TabInputText &&
						tab.input.uri.fsPath === uri.fsPath,
				),
			"the file is not open",
		);
	});
});
