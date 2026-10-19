import * as assert from "node:assert";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { DaemonsService, type DaemonsState } from "../../daemonsService";
import { MiseService } from "../../miseService";
import { type Daemon, describeDaemon } from "../../utils/daemons";
import { safeExec } from "../../utils/shell";
import { isMiseAtLeast } from "../test-utils";

const DEADLINE_MS = 30_000;

/**
 * The daemons of fixtures/daemons-workspace: `web`, `api` (which depends on
 * `web`) and `worker` (which runs the task `test`) in mise.toml, `clock`,
 * `ticker`, `crasher` (which fails 5 seconds after it starts), `once` (a
 * oneshot) and `hourly` (a cron daemon) in pitchfork.toml. The suite has a pitchfork supervisor of its own
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

	/** The errors the extension showed, for the assertion messages */
	const errors: string[] = [];
	setup(() => {
		errors.length = 0;
		sinon
			.stub(vscode.window, "showErrorMessage")
			.callsFake(async (message: string) => {
				errors.push(message);
				return undefined;
			});
	});
	teardown(() => {
		sinon.restore();
	});

	/** Polls the daemon until it has one of the statuses */
	const waitForStatus = async (name: string, ...statuses: string[]) => {
		const deadline = Date.now() + DEADLINE_MS;
		let state = await load();
		let daemon = daemonNamed(state, name);
		while (!statuses.includes(daemon.status) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			state = await load();
			daemon = daemonNamed(state, name);
		}
		assert.ok(
			statuses.includes(daemon.status),
			`${name} should be ${statuses.join(" or ")}, got ${daemon.status} (supervisor ${state.supervisor}, errors: ${errors.join(" | ") || "none"})`,
		);
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
				{ name: "api", kind: "mise", status: "available" },
				{ name: "clock", kind: "pitchfork", status: "available" },
				{ name: "crasher", kind: "pitchfork", status: "available" },
				{ name: "hourly", kind: "pitchfork", status: "available" },
				{ name: "once", kind: "pitchfork", status: "available" },
				{ name: "ticker", kind: "pitchfork", status: "available" },
				{ name: "web", kind: "mise", status: "available" },
				{ name: "worker", kind: "mise", status: "available" },
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

	const miseToml = () =>
		vscode.workspace.openTextDocument(path.join(workspaceRoot, "mise.toml"));

	const completionsAt = async (line: number, character: number) => {
		const document = await miseToml();
		const list = await vscode.commands.executeCommand<vscode.CompletionList>(
			"vscode.executeCompletionItemProvider",
			document.uri,
			new vscode.Position(line, character),
		);
		return list.items.map((item) => ({
			label: typeof item.label === "string" ? item.label : item.label.label,
			detail: item.detail ?? "",
		}));
	};

	test("completes daemon names", async () => {
		// `daemons = ["|web"]` of a task: daemons and groups
		const ofTask = await completionsAt(17, 12);
		for (const name of ["web", "api", "backend"]) {
			assert.ok(
				ofTask.some((item) => item.label === name),
				`Expected ${name}, got: ${ofTask.map((item) => item.label).join(", ")}`,
			);
		}
		assert.match(
			ofTask.find((item) => item.label === "web")?.detail ?? "",
			/^daemon · /,
		);
		assert.match(
			ofTask.find((item) => item.label === "backend")?.detail ?? "",
			/^daemon group: web, api$/,
		);

		// `depends = ["|web"]` of api: the other daemons only, and no task
		const ofDaemon = (await completionsAt(11, 12)).map((item) => item.label);
		assert.ok(ofDaemon.includes("web"));
		assert.ok(!ofDaemon.includes("api"), "a daemon does not depend on itself");
		assert.ok(!ofDaemon.includes("backend"), "depends names daemons");
		assert.ok(!ofDaemon.includes("test"), "depends of a daemon is not a task");
	});

	test("goes from a daemon name to its declaration", async () => {
		const document = await miseToml();
		for (const [line, character] of [
			[17, 13],
			[11, 13],
			[14, 13],
		] as const) {
			const locations =
				(await vscode.commands.executeCommand<
					(vscode.Location | vscode.LocationLink)[]
				>(
					"vscode.executeDefinitionProvider",
					document.uri,
					new vscode.Position(line, character),
				)) ?? [];
			assert.deepEqual(
				locations.map((location) =>
					"targetRange" in location
						? location.targetRange.start.line
						: location.range.start.line,
				),
				[6],
				`${line + 1}:${character + 1} should go to [daemons.web] only`,
			);
		}
	});

	test("shows the status of a daemon name on hover", async () => {
		const document = await miseToml();
		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				document.uri,
				new vscode.Position(17, 13),
			)) ?? [];
		const text = hovers
			.flatMap((hover) => hover.contents)
			.map((content) =>
				typeof content === "string"
					? content
					: (content as vscode.MarkdownString).value,
			)
			.join("\n");
		assert.match(text, /\*\*web\*\*/);
		assert.match(text, /Status: available/);
		assert.match(text, /\[Start\]\(command:mise\.startDaemon\?/);
	});

	test("completes and resolves the task a daemon runs", async () => {
		// `task = "|test"` of worker
		const tasks = (await completionsAt(21, 8)).map((item) => item.label);
		assert.ok(tasks.includes("test"), `got: ${tasks.join(", ")}`);
		assert.ok(!tasks.includes("api"), "task names a task, not a daemon");

		const document = await miseToml();
		const locations =
			(await vscode.commands.executeCommand<
				(vscode.Location | vscode.LocationLink)[]
			>(
				"vscode.executeDefinitionProvider",
				document.uri,
				new vscode.Position(21, 9),
			)) ?? [];
		assert.deepEqual(
			locations.map((location) =>
				"targetRange" in location
					? location.targetRange.start.line
					: location.range.start.line,
			),
			[16],
			"should go to [tasks.test]",
		);
	});

	test("does not take a daemon name for the task of that name", async () => {
		const document = await miseToml();
		// `daemons = ["web"]` names the daemon web, not the task web
		const references =
			(await vscode.commands.executeCommand<vscode.Location[]>(
				"vscode.executeReferenceProvider",
				document.uri,
				new vscode.Position(17, 13),
			)) ?? [];
		assert.deepEqual(
			references.map((reference) => reference.range.start.line),
			[],
		);
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

	test("starts and stops a group of daemons", async () => {
		const backend = (await load()).groups.find(
			(group) => group.name === "backend",
		);
		assert.deepEqual(backend?.members, ["web", "api"]);
		await vscode.commands.executeCommand("mise.startDaemonGroup", backend);
		await waitForStatus("web", "running");
		await waitForStatus("api", "running");
		// the others are left alone
		assert.notEqual(daemonNamed(await load(), "worker").status, "running");

		await vscode.commands.executeCommand("mise.stopDaemonGroup", backend);
		await waitForStatus("web", "stopped", "available");
		await waitForStatus("api", "stopped", "available");
	});

	test("resets the data of a daemon", async () => {
		// a preset would download its database: web stands for one here
		const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mise-e2e-data-"));
		await fs.writeFile(path.join(dataDir, "PG_VERSION"), "18");
		const web = { ...daemonNamed(await load(), "web"), dataDir };

		await daemonsService.resetData(web);
		assert.ok(!existsSync(dataDir), "the data directory is removed");
		await waitForStatus("web", "running");

		await vscode.commands.executeCommand("mise.stopDaemon", web);
		await waitForStatus("web", "stopped", "available");
	});

	test("does not reset a data directory holding the workspace", async () => {
		const web = { ...daemonNamed(await load(), "web"), dataDir: workspaceRoot };
		await assert.rejects(
			daemonsService.resetData(web),
			/cannot be reset|no data/,
		);
		assert.ok(existsSync(path.join(workspaceRoot, "mise.toml")));
	});

	test("starts and stops a pitchfork daemon", async () => {
		const clock = daemonNamed(await load(), "clock");
		await vscode.commands.executeCommand("mise.startDaemon", clock);
		const running = await waitForStatus("clock", "running");
		await waitForLens("pitchfork.toml", 0, "$(debug-stop) Stop");

		await vscode.commands.executeCommand("mise.stopDaemon", running);
		await waitForStatus("clock", "stopped");
	});

	test("disables and enables a daemon", async () => {
		const clock = daemonNamed(await load(), "clock");
		await vscode.commands.executeCommand("mise.disableDaemon", clock);
		assert.equal(daemonNamed(await load(), "clock").disabled, true);
		await vscode.commands.executeCommand("mise.enableDaemon", clock);
		assert.equal(daemonNamed(await load(), "clock").disabled, false);
	});

	test("shows a oneshot daemon that ran to completion", async () => {
		const once = daemonNamed(await load(), "once");
		await vscode.commands.executeCommand("mise.startDaemon", once);
		const done = await waitForStatus("once", "completed");
		assert.equal(done.oneshot, true);
	});

	test("shows when a cron daemon runs next", async () => {
		// the supervisor runs by now, and knows the schedule from the config
		const hourly = daemonNamed(await load(), "hourly");
		assert.equal(hourly.cron?.schedule, "0 0 * * * *");
		assert.ok(hourly.cron?.nextRun, "the supervisor reports the next run");
		assert.match(describeDaemon(hourly), / · next /);
	});

	test("lists the shared servers of the global config", async () => {
		const globalConfig = process.env.MISE_GLOBAL_CONFIG_FILE ?? "";
		assert.ok(globalConfig, "the suite has a global config of its own");
		await fs.writeFile(
			globalConfig,
			'[settings]\nexperimental = true\n\n[daemon_providers.shared-pg]\npreset = "postgres"\nversion = "18"\n',
		);
		try {
			const servers =
				process.platform === "win32" ? [] : (await load()).sharedServers;
			assert.deepEqual(
				servers.map(({ name, kind, status }) => ({ name, kind, status })),
				process.platform === "win32"
					? []
					: [{ name: "shared-pg", kind: "provider", status: "available" }],
			);
		} finally {
			await fs.rm(globalConfig, { force: true });
		}
	});

	test("notifies when a running daemon fails", async () => {
		const warnings: string[] = [];
		sinon
			.stub(vscode.window, "showWarningMessage")
			.callsFake(async (message: string) => {
				warnings.push(message);
				return undefined;
			});
		{
			const crasher = daemonNamed(await load(), "crasher");
			// it runs 5 seconds, then exits with 3
			await vscode.commands.executeCommand("mise.startDaemon", crasher);
			await waitForStatus("crasher", "errored", "failed");
			// the hidden view checks every 15 seconds while a daemon runs
			const deadline = Date.now() + 40_000;
			while (
				!warnings.some((message) => message.includes("crasher")) &&
				Date.now() < deadline
			) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			assert.ok(
				warnings.some((message) => /^Daemon crasher failed/.test(message)),
				`Expected a notification, got: ${warnings.join(" | ")}`,
			);
		}
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
		// pitchfork may also drop it from its state: declared, not started
		await waitForStatus("ticker", "stopped", "available");
	});
});
