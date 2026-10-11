import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";

const execFileAsync = promisify(execFile);

const NOT_TRUSTED_LENS = "$(shield) Not trusted. File not loaded";

type ShownMessage = {
	level: "showErrorMessage" | "showWarningMessage" | "showInformationMessage";
	message: string;
};

/**
 * In paranoid mode, mise binds the trust of a config file to its content: an
 * edited file has to be approved again before mise reads it. The extension
 * must never approve it on its own, which `mise.automaticallyTrustMiseConfigFiles`
 * (on by default) did on activation and after every change to the file. With
 * `mise.trustOwnEditsInParanoidMode`, only the files the user saves in vscode
 * are trusted again without asking.
 *
 * The suite runs with `MISE_PARANOID=1` and a trust store of its own, in which
 * nothing is trusted when vscode starts.
 */
suite("Paranoid Trust Test Suite", function () {
	this.timeout(60_000);

	const sandbox = sinon.createSandbox();

	let workspaceRoot: string;
	let configPath: string;
	let originalConfig: string;
	let miseBinaryPath: string;
	let shownMessages: ShownMessage[];

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const mise = (...args: string[]) =>
		execFileAsync(miseBinaryPath, args, { cwd: workspaceRoot });

	/** `mise trust --show` prints `<path>: trusted|untrusted`, one per file */
	const isFileTrusted = async (filePath: string) => {
		const { stdout } = await mise("trust", "--show");
		const real = await realpath(filePath);
		return stdout
			.split("\n")
			.some((line) =>
				[`${filePath}: trusted`, `${real}: trusted`].includes(
					line.trim().replace(/^~/, homedir()),
				),
			);
	};

	const isTrusted = () => isFileTrusted(configPath);

	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	const waitFor = async (
		condition: () => Promise<boolean> | boolean,
		message: string,
	) => {
		const deadline = Date.now() + 10_000;
		while (!(await condition())) {
			assert.ok(Date.now() < deadline, message);
			await sleep(100);
		}
	};

	/** the file watcher reloads within a second or so of a change */
	const assertStaysUntrusted = async (message: string) => {
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline) {
			assert.equal(await isTrusted(), false, message);
			await sleep(250);
		}
	};

	const codeLensTitles = async (filePath = configPath) => {
		// code lenses are only computed for an open document
		const document = await vscode.workspace.openTextDocument(filePath);
		const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
			"vscode.executeCodeLensProvider",
			document.uri,
		);
		return (lenses ?? []).map((lens) => ({
			title: lens.command?.title,
			command: lens.command?.command,
		}));
	};

	const showsNotTrustedLens = async (filePath = configPath) =>
		(await codeLensTitles(filePath)).some(
			({ title }) => title === NOT_TRUSTED_LENS,
		);

	/** an edit typed and saved in vscode */
	const editAndSaveInEditor = async (line: string, filePath = configPath) => {
		const document = await vscode.workspace.openTextDocument(filePath);
		await waitFor(
			async () => document.getText() === (await readFile(filePath, "utf8")),
			"the editor should show the file as it is on disk",
		);

		const edit = new vscode.WorkspaceEdit();
		edit.insert(
			document.uri,
			document.positionAt(document.getText().length),
			line,
		);
		assert.ok(await vscode.workspace.applyEdit(edit), "the edit is applied");
		// an api save is reported as a manual save, like ctrl+s
		assert.ok(await document.save(), "the document is saved");
	};

	/** an edit made outside of vscode, e.g. by a `git checkout` */
	const editOutsideEditor = async (line: string) => {
		const content = await readFile(configPath, "utf8");
		await writeFile(configPath, `${content}${line}`);
	};

	const setTrustOwnEdits = (value: boolean | undefined) =>
		vscode.workspace
			.getConfiguration("mise")
			.update(
				"trustOwnEditsInParanoidMode",
				value,
				vscode.ConfigurationTarget.Global,
			);

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		configPath = path.join(workspaceRoot, "mise.toml");
		originalConfig = await readFile(configPath, "utf8");

		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		miseBinaryPath = miseService.getMiseBinaryPath() ?? "";
		assert.ok(miseBinaryPath, "mise binary should be resolved");

		const { stdout } = await mise("settings", "get", "paranoid");
		assert.equal(stdout.trim(), "true", "the suite must run in paranoid mode");

		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
		// the views load once the extension starts
		await sleep(3_000);
	});

	setup(() => {
		shownMessages = [];
		for (const level of [
			"showErrorMessage",
			"showWarningMessage",
			"showInformationMessage",
		] as const) {
			sandbox.stub(vscode.window, level).callsFake(async (message: string) => {
				shownMessages.push({ level, message });
				// dismissed, like closing the dialog
				return undefined;
			});
		}
	});

	teardown(async () => {
		sandbox.restore();
		await setTrustOwnEdits(undefined);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		await writeFile(configPath, originalConfig);
	});

	test("does not trust the config file on activation", async () => {
		assert.equal(await isTrusted(), false);
	});

	test("shows no message about an untrusted config file", async () => {
		assert.equal(await isTrusted(), false);

		// every view reads the changed config with mise, and is refused
		await editOutsideEditor('UNTRUSTED_EDIT = "yes"\n');
		await waitFor(
			showsNotTrustedLens,
			"the code lens should show the file is not trusted",
		);
		await sleep(3_000);

		// the status bar and the code lens are enough
		assert.deepEqual(
			shownMessages,
			[],
			"no notification expected for an untrusted config file",
		);
	});

	test("reports no error when a command reads an untrusted config", async () => {
		assert.equal(await isTrusted(), false);

		// reads the config with `mise doctor`, which answers nothing here
		await vscode.commands.executeCommand("mise.configureAllSdkPaths");
		await sleep(2_000);

		assert.deepEqual(
			shownMessages.filter(({ level }) => level !== "showInformationMessage"),
			[],
			"no error or warning expected for an untrusted config file",
		);
	});

	test("offers to review an untrusted config from a code lens", async () => {
		assert.equal(await isTrusted(), false);

		assert.deepEqual(await codeLensTitles(), [
			{ title: NOT_TRUSTED_LENS, command: "mise.reviewUntrustedConfig" },
		]);
	});

	test("reviews and trusts an untrusted config from the status bar", async () => {
		assert.equal(await isTrusted(), false);
		(
			vscode.window.showInformationMessage as unknown as sinon.SinonStub
		).callsFake(async (message: string, ...items: unknown[]) => {
			shownMessages.push({ level: "showInformationMessage", message });
			// the review dialog is the only modal one
			const options = items[0];
			return typeof options === "object" && options && "modal" in options
				? items[1]
				: undefined;
		});

		// the status bar runs this command while a config file is not trusted
		await vscode.commands.executeCommand("mise.reviewUntrustedConfig");

		assert.ok(
			shownMessages.some(({ message }) =>
				message.includes("mise.toml until you trust it"),
			),
			`review dialog expected, got ${JSON.stringify(shownMessages, null, 2)}`,
		);
		await waitFor(isTrusted, "the reviewed file should be trusted");

		// mise reads the config again: there is nothing left to review
		await vscode.commands.executeCommand("mise.reviewUntrustedConfig");
		assert.equal(
			shownMessages.at(-1)?.message,
			"No mise config file is waiting to be trusted.",
		);
	});

	test("toggles trusting own edits from a code lens", async () => {
		await mise("trust");
		const toggle = async () =>
			(await codeLensTitles()).find(
				({ command }) => command === "mise.toggleTrustOwnEditsInParanoidMode",
			)?.title;

		await waitFor(
			async () => (await toggle()) === "Trust my own edits: off",
			"the code lens should offer to trust own edits",
		);
		await vscode.commands.executeCommand(
			"mise.toggleTrustOwnEditsInParanoidMode",
		);

		assert.equal(
			vscode.workspace
				.getConfiguration("mise")
				.get("trustOwnEditsInParanoidMode"),
			true,
		);
		await waitFor(
			async () => (await toggle()) === "Trust my own edits: on",
			"the code lens should show that own edits are trusted",
		);
	});

	test("does not trust a change made outside vscode when the file is saved afterwards", async () => {
		await setTrustOwnEdits(true);
		await mise("trust", configPath);

		// e.g. a `git pull` the user has not reviewed
		await editOutsideEditor('PULLED = "yes"\n');
		assert.equal(await isTrusted(), false);
		await editAndSaveInEditor('OWN_EDIT_AFTER_PULL = "yes"\n');

		await assertStaysUntrusted("saving approved a change made outside vscode");
	});

	test("trusts a .tool-versions saved in vscode with trustOwnEditsInParanoidMode", async () => {
		const toolVersions = path.join(workspaceRoot, ".tool-versions");
		await writeFile(toolVersions, "# no tools\n");
		try {
			await setTrustOwnEdits(true);
			await mise("trust", configPath);
			await mise("trust", toolVersions);

			await editAndSaveInEditor("# edited in vscode\n", toolVersions);

			await waitFor(
				() => isFileTrusted(toolVersions),
				"the saved .tool-versions should be trusted again",
			);
			await sleep(2_000);
			assert.equal(await isFileTrusted(toolVersions), true);
		} finally {
			await rm(toolVersions, { force: true });
		}
	});

	test("trusts the config file mise fmt rewrites with trustOwnEditsInParanoidMode", async () => {
		await setTrustOwnEdits(true);
		await editOutsideEditor('UNFORMATTED="yes"\n');
		await mise("trust", configPath);

		await vscode.commands.executeCommand("mise.fmt");

		await waitFor(
			async () =>
				(await readFile(configPath, "utf8")).includes('UNFORMATTED = "yes"'),
			"mise fmt should format the file",
		);
		await waitFor(isTrusted, "the formatted file should be trusted again");
		await sleep(2_000);
		assert.equal(await isTrusted(), true);
	});

	test("trusts every untrusted config file at once", async () => {
		const localConfig = path.join(workspaceRoot, "mise.local.toml");
		await writeFile(localConfig, '[env]\nLOCAL = "yes"\n');
		try {
			await editOutsideEditor('BOTH_UNTRUSTED = "yes"\n');
			(
				vscode.window.showInformationMessage as unknown as sinon.SinonStub
			).callsFake(async (message: string, ...items: unknown[]) => {
				shownMessages.push({ level: "showInformationMessage", message });
				// the review dialog lists both files once mise refused one of them
				return message.includes("these files") ? items[1] : undefined;
			});

			await waitFor(async () => {
				await vscode.commands.executeCommand("mise.reviewUntrustedConfig");
				return (await isTrusted()) && (await isFileTrusted(localConfig));
			}, "both files should be trusted from a single review");
		} finally {
			await rm(localConfig, { force: true });
		}
	});

	test("shows a config file the user told mise to ignore", async () => {
		const localConfig = path.join(workspaceRoot, "mise.local.toml");
		await writeFile(localConfig, '[env]\nIGNORED = "yes"\n');
		try {
			await mise("trust", "--ignore", localConfig);

			await waitFor(
				async () =>
					(await codeLensTitles(localConfig)).some(
						({ title }) =>
							title === "$(eye-closed) Ignored by mise. File not loaded",
					),
				"the ignored file should say so",
			);
		} finally {
			await rm(localConfig, { force: true });
		}
	});

	test("reports an untrusted monorepo project that mise skips", async () => {
		const projectConfig = path.join(
			workspaceRoot,
			"projects",
			"fe",
			"mise.toml",
		);
		await mkdir(path.dirname(projectConfig), { recursive: true });
		await writeFile(projectConfig, '[tasks.fe]\nrun = "echo fe"\n');
		try {
			await writeFile(
				configPath,
				`monorepo_root = true\n\n[monorepo]\nconfig_roots = ["projects/*"]\n\n${originalConfig}`,
			);
			await mise("trust", configPath);

			// `mise tasks ls --all` succeeds, and only warns about the project
			await waitFor(
				async () => {
					await vscode.commands.executeCommand("mise.reviewUntrustedConfig");
					return shownMessages.some(({ message }) =>
						message.includes(
							`${path.join("projects", "fe", "mise.toml")} until you trust it`,
						),
					);
				},
				`the project should be reported, got ${JSON.stringify(shownMessages)}`,
			);
		} finally {
			await rm(path.join(workspaceRoot, "projects"), {
				recursive: true,
				force: true,
			});
			await writeFile(configPath, originalConfig);
		}
	});

	test("does not trust the config file again after it changed outside vscode", async () => {
		// the user approves the file, as `mise trust` would ask them to
		await mise("trust");
		assert.equal(await isTrusted(), true);

		await editOutsideEditor('OUTSIDE_EDIT = "yes"\n');
		assert.equal(await isTrusted(), false, "mise untrusts the edited file");

		await assertStaysUntrusted(
			"the extension trusted the edited file without asking",
		);
	});

	test("does not trust a config file saved in vscode by default", async () => {
		await mise("trust");

		await editAndSaveInEditor('OWN_EDIT_ASKED = "yes"\n');

		await waitFor(
			showsNotTrustedLens,
			"the code lens should offer to trust the saved file",
		);
		await assertStaysUntrusted("the saved file was trusted without asking");
	});

	test("trusts a config file saved in vscode with trustOwnEditsInParanoidMode", async () => {
		await setTrustOwnEdits(true);
		await mise("trust");

		await editAndSaveInEditor('OWN_EDIT_TRUSTED = "yes"\n');

		await waitFor(isTrusted, "the saved file should be trusted again");
		// the reloads triggered by the save are over by then
		await sleep(2_000);
		assert.equal(await isTrusted(), true);
		assert.equal(
			await showsNotTrustedLens(),
			false,
			"the user's own edit is not shown as untrusted",
		);
	});

	test("still asks for changes made outside vscode with trustOwnEditsInParanoidMode", async () => {
		await setTrustOwnEdits(true);
		await mise("trust");

		await editOutsideEditor('OUTSIDE_EDIT_WITH_SETTING = "yes"\n');

		await assertStaysUntrusted(
			"the extension trusted a change made outside vscode",
		);
	});
});
