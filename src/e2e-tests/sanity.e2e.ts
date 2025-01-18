import * as assert from "node:assert";
import * as vscode from "vscode";

suite("Sanity Test Suite", () => {
	suiteTeardown(() => {
		vscode.window.showInformationMessage("All tests done!");
	});

	test("Extension should be present", async () => {
		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "Extension should be available");
	});

	test("Command should be registered", async () => {
		await vscode.commands.executeCommand("mise.doctor");
	});
});
