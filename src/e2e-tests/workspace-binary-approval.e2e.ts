import * as assert from "node:assert";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { APPROVED_WORKSPACE_BINARIES_KEY, MiseService } from "../miseService";
import { hashFile } from "../utils/fileUtils";

/**
 * A mise binary committed to the repository is repository-controlled code, and
 * `mise.binPath` can be set from a workspace `.vscode/settings.json`. Opening
 * such a project must not run that binary until the user approves it.
 *
 * The fake binary writes a log every time it runs, so the assertions check it
 * was really never executed rather than only which path the extension picked.
 * Each test gets its own binary path: the extension host runs its own
 * MiseService against the same settings, and a shared path would let one test
 * observe the approval another one granted.
 */
suite("Workspace Binary Approval Test Suite", function () {
	this.timeout(30_000);

	const sandbox = sinon.createSandbox();
	// matched on the detail, not the title: the title changes when the binary
	// was approved before and has since been swapped
	const APPROVAL_DETAIL = "Only allow this if you trust the project";
	const isApprovalPrompt = (args: unknown[]) => {
		const options = args[1] as { detail?: unknown } | undefined;
		return (
			typeof options?.detail === "string" &&
			options.detail.includes(APPROVAL_DETAIL)
		);
	};

	let workspaceRoot: string;
	let binDir: string;
	let fakeMisePath: string;
	let originalBinPath: string | undefined;
	let binDirCount = 0;

	const getGlobalBinPathValue = () =>
		vscode.workspace.getConfiguration("mise").inspect<string>("binPath")
			?.globalValue;

	const updateBinPath = (value: string | undefined) =>
		vscode.workspace
			.getConfiguration("mise")
			.update("binPath", value, vscode.ConfigurationTarget.Global);

	/** Context whose globalState survives across MiseService instances */
	const createFakeContext = () => {
		const globalStore = new Map<string, unknown>();
		return {
			workspaceState: { get: () => undefined },
			globalState: {
				get: (key: string, fallback?: unknown) =>
					globalStore.get(key) ?? fallback,
				update: async (key: string, value: unknown) => {
					globalStore.set(key, value);
				},
			},
		} as unknown as vscode.ExtensionContext;
	};

	/**
	 * `showWarningMessage` also serves logger warnings, so only the approval
	 * prompts are answered and counted.
	 */
	const stubApprovalDialog = (answer: "approve" | "dismiss") => {
		const stub = sandbox.stub(vscode.window, "showWarningMessage");
		stub.callsFake(async (...args: unknown[]) => {
			if (!isApprovalPrompt(args)) {
				return undefined as never;
			}
			const labels = args.filter((arg) => typeof arg === "string");
			return answer === "approve"
				? (labels[labels.length - 1] as never)
				: (undefined as never);
		});
		return {
			get promptCount() {
				return stub.getCalls().filter((call) => isApprovalPrompt(call.args))
					.length;
			},
			get prompts() {
				return JSON.stringify(stub.args);
			},
		};
	};

	const wasFakeMiseExecuted = async () =>
		(await readdir(binDir)).includes("executed.log");

	/**
	 * The extension host reacts to settings changes on its own schedule. Waiting
	 * lets it finish while the intended stub is still installed, otherwise it
	 * could answer one test's prompt with the next test's stub.
	 */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

	// deliberately not settled: the service under test must read the setting
	// before the extension host reacts and possibly rewrites it
	const configureFakeBinary = () =>
		updateBinPath(`./${path.basename(binDir)}/mise`);

	/**
	 * Writes the stand-in binary. Every variant must append to the log, that is
	 * what makes "was never executed" observable rather than vacuously true.
	 */
	const writeFakeMise = async (banner: string) => {
		await writeFile(
			fakeMisePath,
			[
				"#!/bin/sh",
				`echo "$@" >> "${path.join(binDir, "executed.log")}"`,
				`echo "${banner}"`,
			].join("\n"),
		);
		await chmod(fakeMisePath, 0o755);
	};

	setup(async function () {
		if (process.platform === "win32") {
			// the fake binary is a shell script
			this.skip();
		}

		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		originalBinPath = getGlobalBinPathValue();

		binDirCount += 1;
		binDir = path.join(workspaceRoot, `bin-approval-${binDirCount}`);
		fakeMisePath = path.join(binDir, "mise");

		await rm(binDir, { recursive: true, force: true });
		await mkdir(binDir, { recursive: true });
		await writeFakeMise("mise 2026.1.0 fake");
	});

	teardown(async () => {
		// restored before the stub is removed, so the reload it triggers is still
		// answered by this test's stub rather than by a real dialog
		await settle();
		await updateBinPath(originalBinPath);
		await settle();
		sandbox.restore();
		await rm(binDir, { recursive: true, force: true });
	});

	test("asks before running a mise binary that lives in the workspace", async () => {
		const dialog = stubApprovalDialog("approve");
		await configureFakeBinary();

		const context = createFakeContext();
		const miseService = new MiseService(context);
		await miseService.initializeMisePath();

		assert.ok(dialog.promptCount >= 1, `never asked: ${dialog.prompts}`);
		assert.ok(
			dialog.prompts.includes(fakeMisePath),
			"the dialog should name the binary that is about to run",
		);
		assert.ok(await wasFakeMiseExecuted(), "the approved binary should run");
		assert.deepEqual(
			context.globalState.get(APPROVED_WORKSPACE_BINARIES_KEY, {}),
			{ [fakeMisePath]: await hashFile(fakeMisePath) },
			"the approval should be persisted against the binary contents",
		);
	});

	test("never runs the workspace binary when the dialog is dismissed", async () => {
		const dialog = stubApprovalDialog("dismiss");
		await configureFakeBinary();

		const context = createFakeContext();
		const miseService = new MiseService(context);
		await miseService.initializeMisePath();

		assert.ok(dialog.promptCount >= 1, `never asked: ${dialog.prompts}`);
		assert.equal(
			await wasFakeMiseExecuted(),
			false,
			"the refused binary must never be executed",
		);
		assert.deepEqual(
			context.globalState.get(APPROVED_WORKSPACE_BINARIES_KEY, {}),
			{},
			"a refusal must not be stored as an approval",
		);
	});

	test("stays idle after a refusal instead of using another mise", async () => {
		stubApprovalDialog("dismiss");
		await configureFakeBinary();

		const miseService = new MiseService(createFakeContext());
		await miseService.initializeMisePath();

		assert.equal(
			miseService.hasValidMiseBinPath,
			false,
			"a refusal must not silently fall back to another mise binary",
		);
		assert.equal(
			miseService.getMiseBinaryPath(),
			undefined,
			"no command may run while the decision is pending",
		);
		assert.equal(
			miseService.pendingBinaryApproval,
			fakeMisePath,
			"the pending binary should be exposed for the status bar to show",
		);
	});

	test("can be reviewed and approved after a refusal", async () => {
		stubApprovalDialog("dismiss");
		await configureFakeBinary();

		const context = createFakeContext();
		const miseService = new MiseService(context);
		await miseService.initializeMisePath();
		assert.equal(miseService.pendingBinaryApproval, fakeMisePath);
		assert.equal(await wasFakeMiseExecuted(), false);

		// what the status bar entry does: ask again, this time approving
		sandbox.restore();
		stubApprovalDialog("approve");
		await miseService.reviewWorkspaceBinary();
		await miseService.initializeMisePath();

		assert.equal(
			miseService.pendingBinaryApproval,
			undefined,
			"the pending state should be cleared once approved",
		);
		assert.equal(miseService.getMiseBinaryPath(), fakeMisePath);
		assert.ok(await wasFakeMiseExecuted(), "the approved binary should run");
	});

	test("does not ask again once the binary was approved", async () => {
		const context = createFakeContext();
		await context.globalState.update(APPROVED_WORKSPACE_BINARIES_KEY, {
			[fakeMisePath]: await hashFile(fakeMisePath),
		});

		// the dialog refuses: reaching the binary proves it was never shown
		stubApprovalDialog("dismiss");
		await configureFakeBinary();

		const miseService = new MiseService(context);
		await miseService.initializeMisePath();

		// the dialog refuses, so only a service holding the stored approval can
		// have run it
		assert.ok(
			await wasFakeMiseExecuted(),
			"a stored approval should be enough to use the binary",
		);
	});

	test("keeps refusing across reloads of the same window", async () => {
		stubApprovalDialog("dismiss");
		await configureFakeBinary();

		const miseService = new MiseService(createFakeContext());
		await miseService.initializeMisePath();
		await miseService.initializeMisePath();

		assert.equal(
			await wasFakeMiseExecuted(),
			false,
			"a refused binary stays unusable",
		);
	});

	test("names settings.json when the project is what set the path", async () => {
		const dialog = stubApprovalDialog("dismiss");
		// the real vector: the path comes from the repository's own settings
		await vscode.workspace
			.getConfiguration("mise")
			.update(
				"binPath",
				`./${path.basename(binDir)}/mise`,
				vscode.ConfigurationTarget.Workspace,
			);

		try {
			const miseService = new MiseService(createFakeContext());
			await miseService.initializeMisePath();

			assert.ok(dialog.promptCount >= 1, `never asked: ${dialog.prompts}`);
			assert.ok(
				dialog.prompts.includes("settings.json"),
				`the dialog should point at the settings file: ${dialog.prompts}`,
			);
			assert.ok(
				dialog.prompts.includes("Inspect settings.json"),
				"the dialog should offer to open the settings file",
			);
			assert.equal(await wasFakeMiseExecuted(), false);
		} finally {
			await vscode.workspace
				.getConfiguration("mise")
				.update("binPath", undefined, vscode.ConfigurationTarget.Workspace);
		}
	});

	test("asks again when the approved binary is swapped for another", async () => {
		const context = createFakeContext();
		await context.globalState.update(APPROVED_WORKSPACE_BINARIES_KEY, {
			[fakeMisePath]: await hashFile(fakeMisePath),
		});

		// the project ships a new version of the launcher it already got approved
		await writeFakeMise("mise 2026.1.0 fake, but different");

		const dialog = stubApprovalDialog("dismiss");
		await configureFakeBinary();

		const miseService = new MiseService(context);
		await miseService.initializeMisePath();

		assert.ok(
			dialog.promptCount >= 1,
			`a changed binary must be approved again: ${dialog.prompts}`,
		);
		assert.ok(
			dialog.prompts.includes("changed since you approved it"),
			`the dialog should say the binary changed: ${dialog.prompts}`,
		);
		assert.equal(await wasFakeMiseExecuted(), false);
	});

	test("approvals can be listed and revoked", async () => {
		const context = createFakeContext();
		stubApprovalDialog("approve");
		await configureFakeBinary();

		const miseService = new MiseService(context);
		await miseService.initializeMisePath();
		assert.deepEqual(miseService.listApprovedWorkspaceBinaries(), [
			fakeMisePath,
		]);

		await miseService.revokeWorkspaceBinaryApprovals([fakeMisePath]);

		assert.deepEqual(miseService.listApprovedWorkspaceBinaries(), []);
		assert.deepEqual(
			context.globalState.get(APPROVED_WORKSPACE_BINARIES_KEY, {}),
			{},
			"the stored approval should be gone",
		);
	});

	test("skips the prompt when the machine setting allows it", async () => {
		const dialog = stubApprovalDialog("dismiss");
		await vscode.workspace
			.getConfiguration("mise")
			.update(
				"skipWorkspaceBinaryApproval",
				true,
				vscode.ConfigurationTarget.Global,
			);

		try {
			await configureFakeBinary();
			const miseService = new MiseService(createFakeContext());
			await miseService.initializeMisePath();

			assert.equal(dialog.promptCount, 0, "the opt-out should skip the prompt");
			assert.equal(miseService.getMiseBinaryPath(), fakeMisePath);
			assert.ok(await wasFakeMiseExecuted(), "the binary should run directly");
		} finally {
			await vscode.workspace
				.getConfiguration("mise")
				.update(
					"skipWorkspaceBinaryApproval",
					undefined,
					vscode.ConfigurationTarget.Global,
				);
		}
	});

	test("does not ask for a mise binary outside of the workspace", async () => {
		const dialog = stubApprovalDialog("dismiss");
		await updateBinPath(undefined);

		const miseService = new MiseService(createFakeContext());
		await miseService.initializeMisePath();

		assert.equal(dialog.promptCount, 0, "a mise from PATH needs no approval");
		assert.ok(miseService.getMiseBinaryPath(), "mise should still be resolved");
		assert.equal(await wasFakeMiseExecuted(), false);
	});
});
