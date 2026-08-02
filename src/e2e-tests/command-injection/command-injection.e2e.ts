import * as assert from "node:assert";
import { exec } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";

const execAsync = promisify(exec);

/**
 * Task and tool names come from the repository configuration, so a repository
 * that gets opened in vscode fully controls them. None of them may ever reach a
 * shell as anything other than a single literal argument.
 *
 * Every name in the fixture carries a payload creating a `pwned-*` file in the
 * workspace: the assertions below check that no such file is ever created,
 * while the task itself still runs and prints its marker.
 */
suite("Command Injection Test Suite", function () {
	this.timeout(60_000);

	const TASK_DQ = 'inj-dq"; touch pwned-dq #';
	const TASK_SQ = "inj-sq'; touch pwned-sq #";
	const TASK_SUB = "inj-sub$(touch pwned-sub)`touch pwned-bt`";
	const TASK_SPACES = "inj spaces & touch pwned-amp | name";

	const INJECTING_TASKS = [
		{ name: TASK_DQ, marker: "marker-dq" },
		{ name: TASK_SQ, marker: "marker-sq" },
		{ name: TASK_SUB, marker: "marker-sub" },
		{ name: TASK_SPACES, marker: "marker-spaces" },
	];

	let workspaceRoot: string;
	let miseService: MiseService;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	const listPwnedFiles = async () =>
		(await readdir(workspaceRoot)).filter((name) => name.startsWith("pwned"));

	const assertNoInjection = async (context: string) => {
		assert.deepEqual(
			await listPwnedFiles(),
			[],
			`${context} executed an injected command`,
		);
	};

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		assert.ok(
			miseService.getMiseBinaryPath(),
			"mise binary should be resolved",
		);
	});

	teardown(async () => {
		for (const name of await listPwnedFiles()) {
			await rm(path.join(workspaceRoot, name), { force: true });
		}
	});

	test("the fixture exposes the task names an attacker would use", async () => {
		const tasks = await miseService.getTasks();

		assert.deepEqual(
			tasks.map((task) => task.name).sort(),
			[TASK_SPACES, TASK_DQ, TASK_SQ, TASK_SUB, "echo-ok"].sort(),
		);
	});

	test("getTaskInfo resolves hostile task names instead of running them", async () => {
		for (const { name } of INJECTING_TASKS) {
			const taskInfo = await miseService.getTaskInfo(name);

			assert.ok(taskInfo, `task info should be returned for ${name}`);
			assert.equal(taskInfo?.name, name);
			await assertNoInjection(`getTaskInfo(${name})`);
		}
	});

	test("the command sent to the terminal runs the task and nothing else", async function () {
		if (process.platform === "win32") {
			// the generated command targets powershell, sh cannot evaluate it
			this.skip();
		}

		for (const { name, marker } of INJECTING_TASKS) {
			const command = miseService.createMiseCommand(["run", name]);
			assert.ok(command, "a command should be built");

			const { stdout } = await execAsync(command as string, {
				cwd: workspaceRoot,
			});

			assert.ok(
				stdout.includes(marker),
				`expected ${marker} in the output of ${name}, got: ${stdout}`,
			);
			await assertNoInjection(`run '${name}'`);
		}
	});

	test("task arguments are passed through without reaching the shell", async function () {
		if (process.platform === "win32") {
			this.skip();
		}

		const command = miseService.createMiseCommand([
			"run",
			"echo-ok",
			"--",
			"$(touch pwned-arg)",
		]);
		assert.ok(command, "a command should be built");

		const { stdout } = await execAsync(command as string, {
			cwd: workspaceRoot,
		});

		assert.ok(stdout.includes("marker-ok"), `unexpected output: ${stdout}`);
		await assertNoInjection("run with an injected argument");
	});

	test("tasks executed through the vscode tasks api stay a single argument", async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: "mise" });

		for (const { name } of INJECTING_TASKS) {
			const task = tasks.find((t) => t.name === name);
			assert.ok(task, `task ${name} should be provided to vscode`);

			const exitCode = await runVsCodeTask(task as vscode.Task);

			assert.equal(exitCode, 0, `task ${name} should succeed`);
			await assertNoInjection(`vscode task '${name}'`);
		}
	});

	test("tool actions running in a terminal quote their arguments", async () => {
		// mise exits non-zero on the unknown setting, the point is that the
		// payload in the name must not be executed by the task shell
		await miseService.runMiseToolActionInConsole(
			["settings", "get", "x; touch pwned-console #"],
			"injection-test",
		);

		await assertNoInjection("runMiseToolActionInConsole");
	});

	test("tool lookups do not execute hostile tool names", async () => {
		const toolName = "x; touch pwned-tool #";

		assert.equal(await miseService.which(toolName), undefined);
		await assertNoInjection("which");

		await miseService.binPaths(toolName).catch(() => []);
		await assertNoInjection("binPaths");

		// mise rejects the unknown setting instead of the payload being run
		await assert.rejects(() =>
			miseService.getSetting("x; touch pwned-setting #"),
		);
		await assertNoInjection("getSetting");
	});

	test("environment variables are written verbatim, without being evaluated", async () => {
		const envFilePath = path.join(workspaceRoot, "mise.injection.toml");
		await writeFile(envFilePath, "");

		try {
			await miseService.miseSetEnv({
				filePath: envFilePath,
				name: "INJECTED",
				value: '$(touch pwned-env) "; touch pwned-env2 #',
			});

			const content = await readFile(envFilePath, "utf8");
			assert.ok(
				content.includes("touch pwned-env"),
				`the value should be stored as written, got: ${content}`,
			);
			await assertNoInjection("miseSetEnv");
		} finally {
			await rm(envFilePath, { force: true });
		}
	});
});

function runVsCodeTask(task: vscode.Task): Promise<number | undefined> {
	return new Promise<number | undefined>((resolve, reject) => {
		const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
			if (event.execution.task === task) {
				disposable.dispose();
				resolve(event.exitCode);
			}
		});

		vscode.tasks.executeTask(task).then(undefined, (error) => {
			disposable.dispose();
			reject(error);
		});
	});
}
