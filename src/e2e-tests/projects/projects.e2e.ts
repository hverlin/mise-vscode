import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Projects webview", function () {
	this.timeout(30_000);

	test("mise.showProjects opens the Projects panel", async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");

		await vscode.commands.executeCommand("mise.showProjects");

		// the webview tab shows up asynchronously
		const deadline = Date.now() + 10_000;
		let tabLabels: string[] = [];
		while (Date.now() < deadline) {
			tabLabels = vscode.window.tabGroups.all.flatMap((group) =>
				group.tabs.map((tab) => tab.label),
			);
			if (tabLabels.includes("Mise: Projects")) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		assert.fail(`Projects tab should be open, got: ${tabLabels.join(", ")}`);
	});

	test("deprecated mise.showTrackedConfig opens the Projects panel", async () => {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		await vscode.commands.executeCommand("mise.showTrackedConfig");

		const deadline = Date.now() + 10_000;
		let tabLabels: string[] = [];
		while (Date.now() < deadline) {
			tabLabels = vscode.window.tabGroups.all.flatMap((group) =>
				group.tabs.map((tab) => tab.label),
			);
			if (tabLabels.includes("Mise: Projects")) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		assert.fail(`Projects tab should be open, got: ${tabLabels.join(", ")}`);
	});
});
