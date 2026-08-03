import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Verifies that a mise tool stub (https://mise.jdx.dev/dev-tools/tool-stubs.html)
 * opens as TOML through the `firstLine` language association contributed in
 * package.json, even though the file has no extension.
 * The fixture lives in `stubs/` (not the conventional `bin/`) because the
 * relative-bin-path and workspace-binary-approval suites wipe `bin/`.
 */
suite("Tool Stub Test Suite", function () {
	this.timeout(30_000);

	test("opens extensionless stubs as TOML via the shebang", async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "stubs", "gh"),
		);
		assert.equal(document.languageId, "toml");
	});
});
