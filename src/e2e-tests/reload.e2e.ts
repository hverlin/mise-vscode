import * as assert from "node:assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { MISE_RELOAD } from "../commands";

/**
 * The internal reloads (file watcher, task end, config change) come in storms
 * and are coalesced. A reload asked for while one runs must still get a run
 * that starts after it: the running one read the state from before.
 */
suite("Reload Test Suite", function () {
	this.timeout(60_000);

	let sandbox: sinon.SinonSandbox;
	let executeCommand: sinon.SinonSpy;

	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	/** The first thing a reload does, see resetState */
	const runStarts = () =>
		executeCommand
			.getCalls()
			.filter(
				(call) =>
					call.args[0] === "setContext" &&
					call.args[1] === "mise.tasksProviderError" &&
					call.args[2] === false,
			);

	const waitForRunStarts = async (count: number) => {
		const deadline = Date.now() + 10_000;
		while (runStarts().length < count && Date.now() < deadline) {
			await sleep(10);
		}
		assert.equal(runStarts().length, count, "the reload should have started");
	};

	/** Asks for a reload, as the file watcher does */
	const askForReload = () => {
		const done = vscode.commands.executeCommand(MISE_RELOAD);
		const requests = executeCommand
			.getCalls()
			.filter((call) => call.args[0] === MISE_RELOAD);
		const request = requests[requests.length - 1];
		assert.ok(request, "the request should be recorded");
		const runsStartedAfter = () =>
			runStarts().filter((run) => run.calledAfter(request)).length;
		return { done, runsStartedAfter };
	};

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "Extension should be available");
		await extension.activate();
		await vscode.commands.executeCommand(MISE_RELOAD);
		// past what the activation asked for
		await sleep(1_500);
	});

	setup(() => {
		sandbox = sinon.createSandbox();
		executeCommand = sandbox.spy(vscode.commands, "executeCommand");
	});

	teardown(() => {
		sandbox.restore();
	});

	test("a reload asked for while one runs gets a run of its own", async () => {
		const running = askForReload();
		await waitForRunStarts(1);
		const asked = askForReload();

		await Promise.all([running.done, asked.done]);
		assert.equal(asked.runsStartedAfter(), 1);
	});

	test("one asked for right after a run gets a run of its own", async () => {
		await askForReload().done;
		const asked = askForReload();

		await asked.done;
		assert.equal(asked.runsStartedAfter(), 1);
	});

	test("the ones asked for while a reload runs share one more run", async () => {
		const running = askForReload();
		await waitForRunStarts(1);
		const storm = Array.from({ length: 5 }, askForReload);

		await Promise.all([running.done, ...storm.map((asked) => asked.done)]);
		for (const asked of storm) {
			assert.equal(asked.runsStartedAfter(), 1);
		}

		await sleep(1_500);
		assert.equal(runStarts().length, 2, "a reload must not ask for another");
	});
});
