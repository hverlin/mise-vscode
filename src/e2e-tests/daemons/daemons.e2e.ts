import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { DaemonsService, type DaemonsState } from "../../daemonsService";
import { MiseService } from "../../miseService";
import type { Daemon } from "../../utils/daemons";
import { safeExec } from "../../utils/shell";
import { isMiseAtLeast } from "../test-utils";

const DEADLINE_MS = 30_000;

/**
 * The daemons of fixtures/daemons-workspace: `web` in mise.toml, `clock` and
 * `ticker` in pitchfork.toml. The suite has a pitchfork supervisor of its own
 * (see .vscode-test.js), stopped at the end.
 */
suite("Daemons Test Suite", function () {
	this.timeout(120_000);

	let workspaceRoot: string;
	let daemonsService: DaemonsService;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const load = () => daemonsService.load();

	const daemonNamed = (state: DaemonsState, name: string): Daemon => {
		const daemon = state.daemons.find((daemon) => daemon.name === name);
		assert.ok(
			daemon,
			`Expected the daemon ${name}, got: ${state.daemons.map((d) => d.id).join(", ")}`,
		);
		return daemon;
	};

	const waitForStatus = async (name: string, status: string) => {
		const deadline = Date.now() + DEADLINE_MS;
		let daemon = daemonNamed(await load(), name);
		while (daemon.status !== status && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			daemon = daemonNamed(await load(), name);
		}
		assert.equal(daemon.status, status, `${name} should be ${status}`);
		return daemon;
	};

	/** Polls the lenses of a file until one on that line has the title */
	const waitForLens = async (fileName: string, line: number, title: string) => {
		const document = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, fileName),
		);
		const deadline = Date.now() + DEADLINE_MS;
		let titles: string[] = [];
		while (Date.now() < deadline) {
			const lenses =
				(await vscode.commands.executeCommand<vscode.CodeLens[]>(
					"vscode.executeCodeLensProvider",
					document.uri,
				)) ?? [];
			titles = lenses
				.filter((lens) => lens.range.start.line === line)
				.map((lens) => lens.command?.title ?? "");
			if (titles.includes(title)) {
				return titles;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		assert.fail(
			`Expected a "${title}" lens on ${fileName}:${line + 1}, got: ${titles.join(", ")}`,
		);
	};

	suiteSetup(async function () {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		const miseBinaryPath = miseService.getMiseBinaryPath() ?? "";
		assert.ok(miseBinaryPath, "mise binary should be resolved");
		// qualified daemon ids and `mise daemons register`
		if (!(await isMiseAtLeast(miseBinaryPath, [2026, 9, 12]))) {
			this.skip();
		}
		// the pitchfork of the fixture
		const install = await safeExec(miseBinaryPath, ["install"], {
			cwd: workspaceRoot,
		});
		assert.equal(install.code, 0, install.stderr);

		daemonsService = new DaemonsService(miseService);
		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
		// once pitchfork is installed
		await vscode.commands.executeCommand("mise.reloadConfiguration");
	});

	suiteTeardown(async () => {
		await vscode.workspace
			.getConfiguration("mise")
			.update("autoStartStopDaemons", undefined, true);
		const pitchfork = await daemonsService?.findPitchfork();
		if (pitchfork) {
			await safeExec(pitchfork.path, ["supervisor", "stop"], {
				cwd: workspaceRoot,
			});
		}
	});

	test("lists the daemons of mise and pitchfork, without a supervisor", async () => {
		const state = await load();
		assert.ok(state.pitchfork?.supported, "pitchfork 2.25.0+ should be found");
		assert.deepEqual(
			state.daemons
				.map(({ name, kind, status }) => ({ name, kind, status }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			[
				{ name: "clock", kind: "pitchfork", status: "available" },
				{ name: "ticker", kind: "pitchfork", status: "available" },
				{ name: "web", kind: "mise", status: "available" },
			],
		);
		// listing never starts one
		assert.equal(state.supervisor, "down");
		assert.equal(
			daemonNamed(state, "web").source,
			path.join(workspaceRoot, "mise.toml"),
		);
	});

	test("shows a start lens over each daemon", async () => {
		await waitForLens("mise.toml", 6, "$(play) Start");
		await waitForLens("pitchfork.toml", 0, "$(play) Start");
		await waitForLens("pitchfork.toml", 3, "$(play) Start");
	});

	test("starts and stops a mise daemon", async () => {
		const web = daemonNamed(await load(), "web");
		await vscode.commands.executeCommand("mise.startDaemon", web);
		const running = await waitForStatus("web", "running");
		assert.equal(running.kind, "mise");
		await waitForLens("mise.toml", 6, "$(debug-stop) Stop");

		await vscode.commands.executeCommand("mise.stopDaemon", running);
		await waitForStatus("web", "stopped");
		await waitForLens("mise.toml", 6, "$(play) Start");
	});

	test("starts and stops a pitchfork daemon", async () => {
		const clock = daemonNamed(await load(), "clock");
		await vscode.commands.executeCommand("mise.startDaemon", clock);
		const running = await waitForStatus("clock", "running");
		await waitForLens("pitchfork.toml", 0, "$(debug-stop) Stop");

		await vscode.commands.executeCommand("mise.stopDaemon", running);
		await waitForStatus("clock", "stopped");
	});

	test("starts and stops the daemons of the workspace session", async () => {
		assert.notEqual(daemonNamed(await load(), "ticker").status, "running");
		await vscode.workspace
			.getConfiguration("mise")
			.update("autoStartStopDaemons", true, true);
		await waitForStatus("ticker", "running");
		// the others start on demand only
		assert.notEqual(daemonNamed(await load(), "clock").status, "running");

		// leaving the session stops it, see PITCHFORK_AUTOSTOP_DELAY
		await vscode.workspace
			.getConfiguration("mise")
			.update("autoStartStopDaemons", undefined, true);
		await waitForStatus("ticker", "stopped");
	});
});
