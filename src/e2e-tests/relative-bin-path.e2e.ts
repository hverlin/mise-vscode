import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, rm, symlink } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { MiseService } from "../miseService";

const execFileAsync = promisify(execFile);

suite("Relative binPath Test Suite", function () {
	this.timeout(20_000);

	const sandbox = sinon.createSandbox();

	let workspaceRoot: string;
	let binDir: string;
	let miseService: MiseService;
	let originalBinPath: string | undefined;

	// initializeMisePath reads workspaceState and stores binary approvals
	const fakeContext = {
		workspaceState: { get: () => undefined },
		globalState: {
			get: (_key: string, fallback?: unknown) => fallback,
			update: async () => {},
		},
	} as unknown as vscode.ExtensionContext;

	const getGlobalBinPathValue = () =>
		vscode.workspace.getConfiguration("mise").inspect<string>("binPath")
			?.globalValue;

	const updateBinPath = (value: string | undefined) =>
		vscode.workspace
			.getConfiguration("mise")
			.update("binPath", value, vscode.ConfigurationTarget.Global);

	setup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		originalBinPath = getGlobalBinPathValue();

		const { stdout } = await execFileAsync("which", ["mise"]);
		const miseBin = stdout.trim();
		assert.ok(miseBin, "mise should be available in PATH");

		binDir = path.join(workspaceRoot, "bin");
		await rm(binDir, { recursive: true, force: true });
		await mkdir(binDir, { recursive: true });
		await symlink(miseBin, path.join(binDir, "mise"));

		// the binary lives in the workspace, so it needs approval to run
		sandbox
			.stub(vscode.window, "showWarningMessage")
			.callsFake(async (...args: unknown[]) => {
				const labels = args.filter((arg) => typeof arg === "string");
				return labels[labels.length - 1] as never;
			});

		miseService = new MiseService(fakeContext);
	});

	teardown(async () => {
		sandbox.restore();
		await updateBinPath(originalBinPath);
		await rm(binDir, { recursive: true, force: true });
	});

	test("a relative binPath is resolved against the workspace and not overwritten", async () => {
		await updateBinPath("./bin/mise");

		await miseService.initializeMisePath();

		assert.equal(
			miseService.getMiseBinaryPath(),
			path.join(workspaceRoot, "bin", "mise"),
		);
		// the configured relative path must survive activation instead of
		// being rewritten to the resolved absolute path
		assert.equal(getGlobalBinPathValue(), "./bin/mise");

		const { stdout } = await miseService.execMiseCommand(["version"]);
		assert.ok(stdout.trim().length > 0, "mise version should produce output");
	});
});
