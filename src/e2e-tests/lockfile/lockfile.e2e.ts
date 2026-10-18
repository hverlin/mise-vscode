import * as assert from "node:assert";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

const LENSES_DEADLINE_MS = 20_000;

/**
 * The code lenses on mise.lock and next to the tools of the config files
 * (see fixtures/lockfile-workspace): yq is not in mise.lock, which is in
 * format 0, and mise.local.toml has no lockfile yet. No lens is clicked, the
 * fixture must stay as it is.
 */
suite("Lockfile Test Suite", function () {
	this.timeout(60_000);

	let workspaceRoot: string;

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		// git ignores it, so the check of the fixtures would not tell
		assert.ok(
			!existsSync(path.join(workspaceRoot, "mise.local.lock")),
			"Remove mise.local.lock from the lockfile-workspace fixture, the suite expects none",
		);
		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	/** Polls the lenses of a file until one has the title expected */
	const waitForLens = async (fileName: string, title: string) => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, fileName),
		);
		await vscode.window.showTextDocument(document);

		const deadline = Date.now() + LENSES_DEADLINE_MS;
		let lenses: vscode.CodeLens[] = [];
		while (Date.now() < deadline) {
			lenses =
				(await vscode.commands.executeCommand<vscode.CodeLens[]>(
					"vscode.executeCodeLensProvider",
					document.uri,
				)) ?? [];
			if (lenses.some((lens) => lens.command?.title === title)) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		const lens = lenses.find((lens) => lens.command?.title === title);
		assert.ok(
			lens,
			`Expected a "${title}" lens on ${fileName}, got: ${lenses
				.map((l) => l.command?.title)
				.join(", ")}`,
		);
		return { lens, lenses, document };
	};

	const lockArguments = (lens: vscode.CodeLens) =>
		lens.command?.arguments?.[0] as { configRoot: string; flags: string[] };

	test("reports mise.lock out of sync and in an old format", async () => {
		const { lens, lenses } = await waitForLens(
			"mise.lock",
			"$(warning) 1 tool out of sync · Update",
		);
		assert.match(
			lens.command?.tooltip ?? "",
			/aqua:mikefarah\/yq \(new\) 4\.52\.4/,
		);
		assert.equal(lens.command?.command, "mise.runLock");
		assert.equal(
			path.basename(lockArguments(lens).configRoot),
			"lockfile-workspace",
		);
		assert.deepEqual(lockArguments(lens).flags, []);

		const upgrade = lenses.find(
			(l) => l.command?.title === "$(versions) Upgrade format v0 → v3",
		);
		assert.ok(upgrade, "Expected a lens to upgrade the format of mise.lock");
		assert.deepEqual(lockArguments(upgrade).flags, ["--upgrade"]);
	});

	test("reports mise.lock out of date next to the tools of mise.toml", async () => {
		const { lens, document } = await waitForLens(
			"mise.toml",
			"$(warning) mise.lock out of date",
		);
		assert.equal(document.lineAt(lens.range.start.line).text.trim(), "[tools]");
		assert.deepEqual(lockArguments(lens).flags, []);
	});

	test("offers to create the lockfile of mise.local.toml", async () => {
		const { lens } = await waitForLens(
			"mise.local.toml",
			"$(lock) Create mise.local.lock",
		);
		assert.deepEqual(lockArguments(lens).flags, ["--local"]);
	});
});
