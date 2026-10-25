import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { isMiseAtLeast } from "../test-utils";

const execFileAsync = promisify(execFile);

/**
 * Paranoid mode for env files only (`paranoid = ["env_files"]`, mise
 * 2026.10.14+): mise.toml is trusted as usual, by its directory, while the
 * `.env` it loads (see fixtures/paranoid-env-files-workspace) needs an
 * approval of its own, again after every edit.
 */
suite("Paranoid Env Files Test Suite", function () {
	this.timeout(60_000);

	const sandbox = sinon.createSandbox();

	let workspaceRoot: string;
	let envFile: string;
	let originalEnvFile: string;
	let miseBinaryPath: string;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const mise = (...args: string[]) =>
		execFileAsync(miseBinaryPath, args, { cwd: workspaceRoot });

	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	const waitFor = async (
		condition: () => Promise<boolean> | boolean,
		message: string,
	) => {
		const deadline = Date.now() + 20_000;
		while (!(await condition())) {
			assert.ok(Date.now() < deadline, message);
			await sleep(250);
		}
	};

	/** mise lists only config files in `trust --show`: it reads the env instead */
	const isEnvTrusted = async () => {
		try {
			await mise("env", "--json");
			return true;
		} catch {
			return false;
		}
	};

	const setTrustOwnEdits = (value: boolean | undefined) =>
		vscode.workspace
			.getConfiguration("mise")
			.update(
				"trustOwnEditsInParanoidMode",
				value,
				vscode.ConfigurationTarget.Global,
			);

	suiteSetup(async function () {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		envFile = path.join(workspaceRoot, ".env");
		originalEnvFile = await readFile(envFile, "utf8");

		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		miseBinaryPath = miseService.getMiseBinaryPath() ?? "";
		assert.ok(miseBinaryPath, "mise binary should be resolved");

		// categories, and env files with trust of their own, come with mise
		// 2026.10.14
		if (!(await isMiseAtLeast(miseBinaryPath, [2026, 10, 14]))) {
			this.skip();
		}

		const { stdout } = await mise("settings", "get", "paranoid");
		assert.equal(
			stdout.trim(),
			'["env_files"]',
			"the suite needs env_files only",
		);

		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	teardown(async () => {
		sandbox.restore();
		await setTrustOwnEdits(undefined);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		await writeFile(envFile, originalEnvFile);
	});

	test("trusts mise.toml on activation, not the env file it loads", async () => {
		// `<path>: trusted|untrusted`, with ~ for the home directory
		await waitFor(
			async () =>
				(await mise("trust", "--show")).stdout
					.split("\n")
					.some(
						(line) =>
							line.trim().replace(/^~/, homedir()) ===
							`${workspaceRoot}: trusted`,
					),
			"the config of the workspace should be trusted",
		);
		assert.equal(await isEnvTrusted(), false, "the env file needs approval");
	});

	test("reviews and trusts the env file", async () => {
		sandbox
			.stub(vscode.window, "showInformationMessage")
			.callsFake(async (message: string, ...items: unknown[]) => {
				const options = items[0];
				return typeof options === "object" &&
					options &&
					"modal" in options &&
					message.includes(".env until you trust it")
					? (items[1] as never)
					: undefined;
			});

		await waitFor(async () => {
			await vscode.commands.executeCommand("mise.reviewUntrustedConfig");
			return isEnvTrusted();
		}, "the env file should be trusted from the review");
	});

	test("trusts the env file saved in vscode with trustOwnEditsInParanoidMode", async () => {
		await setTrustOwnEdits(true);
		await mise("trust", envFile);
		await vscode.commands.executeCommand("mise.refreshEntry");
		await waitFor(
			() => process.env.ENV_FILE_VAR === "one",
			"the extension should load the env file",
		);

		const document = await vscode.workspace.openTextDocument(envFile);
		const edit = new vscode.WorkspaceEdit();
		edit.insert(
			document.uri,
			document.positionAt(document.getText().length),
			"ENV_FILE_EDIT=two\n",
		);
		assert.ok(await vscode.workspace.applyEdit(edit), "the edit is applied");
		// typing gives the extension the time to check the trust of the file
		await sleep(1_500);
		assert.ok(await document.save(), "the document is saved");

		await waitFor(
			async () => (await isEnvTrusted()) && process.env.ENV_FILE_EDIT === "two",
			"the saved env file should be trusted again, and loaded",
		);
	});
});
