import * as assert from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { parseMiseError } from "../../utils/miseUtilts";

/**
 * What the extension does while a config file does not parse.
 *
 * With auto save on this is the common case, not the exception: a half typed
 * line reaches disk and every mise command fails until the file parses again.
 * The views keep what they last read instead of emptying, which these tests
 * pin down, along with the cases where that state must NOT be kept.
 *
 * The fixture is broken and restored inside each test, so a failure never
 * leaves the workspace in a state the next test inherits.
 */
suite("Broken Config Test Suite", function () {
	this.timeout(30_000);

	let workspaceRoot: string;
	let miseTomlPath: string;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const createMiseService = async () => {
		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		assert.ok(miseService.getMiseBinaryPath(), "mise binary should resolve");
		return miseService;
	};

	/** Everything the views read before they can render anything */
	const readEverything = (miseService: MiseService) =>
		Promise.all([
			miseService.getTasks(),
			miseService.getMiseConfigFiles(),
			miseService.getEnvWithInfo(),
			miseService.getCurrentToolsIncludingMonorepo(),
			miseService.getMonorepoProjectEnvs(),
			miseService.getAllCachedTasks(),
			miseService.getOutdatedTools(),
		]);

	/** What auto save writes in the middle of typing a new section */
	const withBrokenConfig = async (run: () => Promise<void>) => {
		const original = await readFile(miseTomlPath, "utf8");
		try {
			await writeFile(miseTomlPath, `${original}\n[tasks.half`);
			await run();
		} finally {
			await writeFile(miseTomlPath, original);
		}
	};

	suiteSetup(async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(root, "Workspace root should be available");
		workspaceRoot = root;
		miseTomlPath = path.join(workspaceRoot, "mise.toml");

		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "Extension should be available");
		await extension.activate();
	});

	test("mise itself refuses to answer while the file does not parse", async () => {
		// the premise of the whole suite: without this the tests below would pass
		// for the wrong reason
		const miseService = await createMiseService();
		await readEverything(miseService);

		await withBrokenConfig(async () => {
			const fresh = await createMiseService();
			await assert.rejects(
				() => fresh.getMiseConfigFiles(),
				"a service with nothing to fall back on should report the failure",
			);
		});
	});

	test("keeps what the views last read", async () => {
		const miseService = await createMiseService();
		const [tasks, configFiles, envs] = await readEverything(miseService);
		assert.ok(configFiles.length > 0 && envs.length > 0);

		await withBrokenConfig(async () => {
			// the caches are dropped, so the commands really run again and fail
			await miseService.invalidateCache();

			assert.deepEqual(await miseService.getTasks(), tasks);
			assert.deepEqual(await miseService.getMiseConfigFiles(), configFiles);
			assert.deepEqual(await miseService.getEnvWithInfo(), envs);

			// each of these failing empties a whole panel
			await assert.doesNotReject(() =>
				miseService.getCurrentToolsIncludingMonorepo(),
			);
			await assert.doesNotReject(() => miseService.getMonorepoProjectEnvs());
			await assert.doesNotReject(() => miseService.getAllCachedTasks());
			await assert.doesNotReject(() => miseService.getOutdatedTools());

			assert.equal(
				miseService.isServingRetainedState,
				true,
				"the status bar has to be able to say so",
			);
		});

		await miseService.invalidateCache();
		await miseService.getMiseConfigFiles();
		assert.equal(
			miseService.isServingRetainedState,
			false,
			"and it has to clear once the file parses again",
		);
	});

	test("keeps the code lenses of the file being edited", async () => {
		const document = await vscode.workspace.openTextDocument(miseTomlPath);
		const lensCount = async () =>
			(
				(await vscode.commands.executeCommand<vscode.CodeLens[]>(
					"vscode.executeCodeLensProvider",
					document.uri,
				)) ?? []
			).length;

		assert.ok((await lensCount()) > 0, "the fixture should have lenses");

		await withBrokenConfig(async () => {
			// the extension's own service has to be in the same state: an internal
			// reload makes it re-read and fall back, without dropping what it kept
			await vscode.commands.executeCommand("mise.refreshEntry");

			assert.ok(
				(await lensCount()) > 0,
				"the lenses should not blink out while typing",
			);
		});
	});

	test("survives an edit that leaves the document shorter than the last parse", async () => {
		// the parser keeps serving the last good parse, whose line numbers can
		// point past the end of the text as it now is
		const document = await vscode.workspace.openTextDocument(miseTomlPath);
		const editor = await vscode.window.showTextDocument(document);
		const original = document.getText();
		const wholeDocument = () =>
			new vscode.Range(
				new vscode.Position(0, 0),
				document.lineAt(document.lineCount - 1).range.end,
			);

		try {
			await editor.edit((edit) => edit.replace(wholeDocument(), "[tasks.half"));

			await assert.doesNotReject(
				() =>
					vscode.commands.executeCommand(
						"vscode.executeCodeLensProvider",
						document.uri,
					) as Promise<unknown>,
				"code lenses should not throw on a shrunken document",
			);
		} finally {
			await editor.edit((edit) => edit.replace(wholeDocument(), original));
			await document.save();
		}
	});

	test("refuses to run a task, naming the real problem", async () => {
		// the views still list the tasks from before the file broke, so this is
		// easy to hit. mise would fail with "task does not exist", which points at
		// the wrong thing entirely
		const sandbox = sinon.createSandbox();
		const miseService = await createMiseService();
		await readEverything(miseService);

		try {
			await withBrokenConfig(async () => {
				await miseService.invalidateCache();
				await miseService.getMiseConfigFiles();
				assert.equal(miseService.isServingRetainedState, true);
				await vscode.commands.executeCommand("mise.refreshEntry");
				// and it has to have actually attempted a read and fallen back: the
				// reload fires the refreshes without waiting for them
				await vscode.commands.executeCommand(
					"vscode.executeCodeLensProvider",
					vscode.Uri.file(miseTomlPath),
				);

				const warning = sandbox
					.stub(vscode.window, "showWarningMessage")
					.resolves(undefined);
				const terminal = sandbox.spy(vscode.window, "createTerminal");

				await miseService.runTask("hello");
				await miseService.watchTask("hello");

				assert.equal(warning.callCount, 2, "running and watching should warn");
				assert.match(
					warning.firstCall.args[0] as string,
					/does not parse/,
					"the warning should name the real problem",
				);
				assert.ok(
					!warning
						.getCalls()
						.some((call) => /not found/.test(String(call.args[0]))),
					"no message should claim the task does not exist",
				);
				assert.equal(terminal.callCount, 0, "nothing should have been run");
			});
		} finally {
			sandbox.restore();
		}
	});

	test("a save the user asked for reports the config as it is now", async () => {
		// auto save lands in the middle of typing and the previous state is kept,
		// but Cmd+S is deliberate: nothing is carried over, so the break surfaces.
		// The reason itself comes from onWillSaveTextDocument in the extension.
		const miseService = await createMiseService();
		const [, configFiles] = await readEverything(miseService);

		await withBrokenConfig(async () => {
			await miseService.invalidateCache();
			assert.deepEqual(
				await miseService.getMiseConfigFiles(),
				configFiles,
				"an auto save should keep the previous state",
			);

			miseService.notifyManualSave(vscode.Uri.file(miseTomlPath));
			await miseService.invalidateCache();

			await assert.rejects(
				() => miseService.getMiseConfigFiles(),
				"a manual save must not be answered with the previous state",
			);
		});
	});

	test("reports what mise said, not just that something failed", async () => {
		// what the views put in front of the user instead of "Error loading tasks"
		const miseService = await createMiseService();

		await withBrokenConfig(async () => {
			const fresh = await createMiseService();
			const error = await fresh.getMiseConfigFiles().then(
				() => undefined,
				(caught) => caught,
			);
			assert.ok(error, "the command should have failed");

			const parsed = parseMiseError(error);
			assert.equal(
				parsed.kind,
				"parse",
				`a broken config should be recognised, got: ${String(error).slice(0, 300)}`,
			);
			assert.ok(parsed.line !== undefined, "the line should be reported");
			// a reason is not in every shape mise renders; when there is one it has
			// to read as words rather than as the box drawing around them
			if (parsed.reason !== undefined) {
				assert.ok(
					/[a-z]/i.test(parsed.reason),
					`the reason should be readable, got: ${parsed.reason}`,
				);
			}
		});

		assert.ok(miseService);
	});
});
