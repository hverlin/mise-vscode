import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as sinon from "sinon";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const CACHE_REFRESH_DEADLINE_MS = 20_000;

/**
 * The experimental task output cache (mise 2026.8.1+): code lens, hover and the
 * cache commands. The fixture keeps its artifacts in a workspace-local cache
 * dir, see the `task-cache` entry of .vscode-test.js.
 */
suite("Task Cache Test Suite", function () {
	this.timeout(60_000);

	const sandbox = sinon.createSandbox();

	let workspaceRoot: string;
	let miseTomlUri: vscode.Uri;

	const runMise = (args: string[]) =>
		execFileAsync("mise", args, { cwd: workspaceRoot });

	const countCacheEntries = async (taskName: string) => {
		const { stdout } = await runMise(["cache", "task", taskName, "--json"]);
		const cacheInfo = JSON.parse(stdout) as Array<{
			task: string;
			entries: unknown[];
		}>;
		return (
			cacheInfo.find((info) => info.task === taskName)?.entries.length ?? 0
		);
	};

	/** Command sent to the mise terminal by the next command execution */
	const captureTerminalCommand = () => {
		const sentCommands: string[] = [];
		sandbox.stub(vscode.window, "createTerminal").returns({
			name: "mise",
			sendText: (text: string) => sentCommands.push(text),
			show: () => {},
			hide: () => {},
			dispose: () => {},
			shellIntegration: undefined,
		} as unknown as vscode.Terminal);
		return sentCommands;
	};

	/**
	 * Polls `read` until `matches` accepts its value, then returns it. The
	 * `mise cache task` output the views are built from is cached briefly: the
	 * artifact watcher normally invalidates it right away, but the file watcher
	 * can stay silent on a loaded CI runner, so the ttl backing it up has to be
	 * waited out. Asserts on the last value seen, so a timeout reports what the
	 * editor was actually showing instead of a bare deadline.
	 */
	const waitFor = async <T>(
		read: () => Promise<T>,
		matches: (value: T) => boolean,
		message: string,
	): Promise<T> => {
		const deadline = Date.now() + CACHE_REFRESH_DEADLINE_MS;
		let value = await read();
		while (!matches(value) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			value = await read();
		}
		assert.ok(matches(value), `${message}, last saw: ${value}`);
		return value;
	};

	const getHoverText = async (needle: string) => {
		const document = await vscode.workspace.openTextDocument(miseTomlUri);
		const lines = document.getText().split("\n");
		const line = lines.findIndex((content) => content.includes(needle));
		assert.ok(line >= 0, `fixture should contain ${needle}`);

		const hovers =
			(await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				miseTomlUri,
				new vscode.Position(line, (lines[line]?.indexOf(needle) ?? 0) + 1),
			)) ?? [];

		return hovers
			.flatMap((hover) => hover.contents)
			.map((content) =>
				typeof content === "string"
					? content
					: (content as { value: string }).value,
			)
			.join("\n");
	};

	suiteSetup(async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(root, "Workspace root should be available");
		workspaceRoot = root;
		miseTomlUri = vscode.Uri.file(path.join(workspaceRoot, "mise.toml"));

		// the cache dir lives inside the fixture and survives between runs, so
		// start from a known state: the tests assert exact entry counts
		await runMise(["cache", "clear", "--task", "*"]);

		// --force: a task whose sources are unchanged is skipped, and a skipped
		// task publishes no cache entry
		await runMise(["run", "--force", "build"]);
	});

	teardown(() => {
		sandbox.restore();
	});

	test("the fixture caches the output of the cached task only", async () => {
		assert.equal(await countCacheEntries("build"), 1);
		assert.equal(await countCacheEntries("plain"), 0);
	});

	test("shows a cache code lens for cache-enabled tasks only", async () => {
		await vscode.workspace.openTextDocument(miseTomlUri);

		const codeLenses =
			(await vscode.commands.executeCommand<vscode.CodeLens[]>(
				"vscode.executeCodeLensProvider",
				miseTomlUri,
			)) ?? [];

		const cacheLenses = codeLenses.filter(
			(lens) => lens.command?.command === "mise.showTaskCacheMenu",
		);

		assert.deepEqual(
			cacheLenses.map((lens) => lens.command?.arguments?.[0]),
			["build", "probe"],
			"only the tasks declaring cache.enabled should get a cache lens",
		);
		assert.match(
			cacheLenses[0]?.command?.title ?? "",
			/Cache · \d/,
			"the lens should report the size of the stored entries",
		);
	});

	test("reports the cache state in the task hover", async () => {
		const hoverText = await getHoverText("[tasks.build]");

		assert.ok(
			hoverText.includes("Cache: 1 entry"),
			`Expected the cache summary in the hover, got: ${hoverText}`,
		);
		assert.ok(
			hoverText.includes("Next run: cache hit"),
			`Expected the hit prediction in the hover, got: ${hoverText}`,
		);
	});

	test("predicts a miss once the sources changed", async () => {
		const inputPath = path.join(workspaceRoot, "src", "input.txt");
		const original = await readFile(inputPath, "utf8");

		try {
			await writeFile(inputPath, "changed input\n");
			const hoverText = await getHoverText("[tasks.build]");

			assert.ok(
				hoverText.includes("Next run: cache miss"),
				`Expected the miss prediction in the hover, got: ${hoverText}`,
			);
		} finally {
			await writeFile(inputPath, original);
		}
	});

	// computing the cache key of a task runs its command inputs
	test("never predicts for a task declaring command inputs", async () => {
		await runMise(["run", "--force", "probe"]);

		// check mise published the entry before waiting on the editor: a run that
		// stored nothing and a hover that never refreshed look identical once the
		// deadline expires, and they have nothing to do with each other
		assert.equal(
			await countCacheEntries("probe"),
			1,
			"mise should have stored one cache entry for probe",
		);

		// wait for the exact text the assertions need, so a transient entry count
		// cannot end the wait early and fail on the next line instead
		const hoverText = await waitFor(
			() => getHoverText("[tasks.probe]"),
			(text) => text.includes("Cache: 1 entry"),
			"Expected the probe cache summary in the hover",
		);

		assert.ok(
			!hoverText.includes("Next run:"),
			`Expected no prediction for a task with command inputs, got: ${hoverText}`,
		);
		assert.ok(
			hoverText.includes("Latest entry:"),
			`Expected the latest cache entry instead, got: ${hoverText}`,
		);
	});

	test("does not report a cache for tasks without one", async () => {
		const hoverText = await getHoverText("[tasks.plain]");

		assert.ok(
			hoverText.includes("plain"),
			`Expected a task hover, got: ${hoverText}`,
		);
		assert.ok(
			!hoverText.includes("Cache:"),
			`Expected no cache section, got: ${hoverText}`,
		);
	});

	test("runs a task with the cache disabled", async () => {
		const sentCommands = captureTerminalCommand();

		await vscode.commands.executeCommand("mise.runTaskWithoutCache", "plain");

		// run flags have to precede the task name, mise passes anything after it
		// to the task itself
		assert.equal(sentCommands.length, 1);
		assert.match(
			sentCommands[0] ?? "",
			/run --task-cache off ["']?plain/,
			`Unexpected command: ${sentCommands[0]}`,
		);
	});

	test("explains the cache key without running the task", async () => {
		const sentCommands = captureTerminalCommand();

		await vscode.commands.executeCommand("mise.explainTaskCache", "build");

		assert.equal(sentCommands.length, 1);
		assert.match(
			sentCommands[0] ?? "",
			/run --dry-run --task-cache-explain ["']?build/,
			`Unexpected command: ${sentCommands[0]}`,
		);
	});

	test("refreshes the cache lens after a task ran outside of the editor", async () => {
		await vscode.commands.executeCommand("mise.clearTaskCache", "build");
		assert.equal(await countCacheEntries("build"), 0);

		const documentUri = miseTomlUri;
		const cacheLensTitle = async () => {
			const codeLenses =
				(await vscode.commands.executeCommand<vscode.CodeLens[]>(
					"vscode.executeCodeLensProvider",
					documentUri,
				)) ?? [];
			return codeLenses.find(
				(lens) => lens.command?.command === "mise.showTaskCacheMenu",
			)?.command?.title;
		};

		assert.equal(
			await cacheLensTitle(),
			"$(database) Cache",
			"the lens should report no stored entry after clearing",
		);

		await runMise(["run", "--force", "build"]);
		assert.equal(
			await countCacheEntries("build"),
			1,
			"mise should have stored one cache entry for build",
		);

		// the document is never touched: the lens has to pick the new entry up on
		// its own, without an edit or a save
		await waitFor(
			async () => (await cacheLensTitle()) ?? "",
			(title) => /Cache · \d/.test(title),
			"Expected the lens to report the new entry",
		);
	});

	// last: the tests above rely on the entry published by suiteSetup
	test("clears the cache entries of a task", async () => {
		assert.equal(await countCacheEntries("build"), 1);

		await vscode.commands.executeCommand("mise.clearTaskCache", "build");

		assert.equal(await countCacheEntries("build"), 0);
	});
});
