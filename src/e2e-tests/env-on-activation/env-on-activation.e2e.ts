import * as assert from "node:assert";
import * as vscode from "vscode";
import { MISE_RELOAD } from "../../commands";

/**
 * Extensions activated after this one (`onStartupFinished`) spawn their
 * processes, such as a formatter, with the env this one left behind when its
 * activation resolved. Activation awaits a reload, which has to resolve with
 * the env applied.
 */
suite("Env on Activation Test Suite", function () {
	this.timeout(60_000);

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "The extension should be installed");
		await extension.activate();
	});

	test("applies the mise env before a reload resolves", async () => {
		// as on startup, before anything applied it
		delete process.env.SLOW_ENV;

		await vscode.commands.executeCommand(MISE_RELOAD, { force: true });

		assert.equal(process.env.SLOW_ENV, "applied");
	});
});
