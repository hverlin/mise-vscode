import * as assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { MISE_RELOAD } from "../../commands";

const RELOAD_DEADLINE_MS = 20_000;

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

		await vscode.commands.executeCommand(MISE_RELOAD);

		assert.equal(process.env.SLOW_ENV, "applied");
	});

	test("reloads when a file merged with include changes", async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(workspaceRoot, "Workspace root should be available");
		const sharedPath = path.join(workspaceRoot, "shared", "env.toml");
		const original = await readFile(sharedPath, "utf8");
		assert.equal(process.env.SHARED_ENV, "from the included file");

		try {
			// mise lists none of its files: only the include of mise.toml names it,
			// and it is out of the reach of the standard config patterns
			await writeFile(sharedPath, '[env]\nSHARED_ENV = "edited"\n');
			const deadline = Date.now() + RELOAD_DEADLINE_MS;
			while (process.env.SHARED_ENV !== "edited" && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			assert.equal(process.env.SHARED_ENV, "edited");
		} finally {
			await writeFile(sharedPath, original);
		}
	});
});
