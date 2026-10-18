import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { isMiseAtLeast } from "../test-utils";

const DIAGNOSTICS_DEADLINE_MS = 20_000;

/**
 * The keys of a config file that mise does not read, or deprecates, from
 * `mise config explain` (see fixtures/config-diagnostics-workspace).
 */
suite("Config Diagnostics Test Suite", function () {
	this.timeout(60_000);

	let configUri: vscode.Uri;

	// the service only reads workspaceState from the context
	const fakeContext = {
		workspaceState: { get: () => undefined },
	} as unknown as vscode.ExtensionContext;

	suiteSetup(async function () {
		const workspaceRoot =
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");
		configUri = vscode.Uri.file(path.join(workspaceRoot, "mise.toml"));

		const miseService = new MiseService(fakeContext);
		await miseService.initializeMisePath();
		const miseBinaryPath = miseService.getMiseBinaryPath() ?? "";
		assert.ok(miseBinaryPath, "mise binary should be resolved");
		// `mise config explain` comes with mise 2026.10.14
		if (!(await isMiseAtLeast(miseBinaryPath, [2026, 10, 14]))) {
			this.skip();
		}

		await vscode.extensions.getExtension("hverlin.mise-vscode")?.activate();
	});

	const waitForDiagnostics = async (count: number) => {
		const deadline = Date.now() + DIAGNOSTICS_DEADLINE_MS;
		const configDiagnostics = () =>
			vscode.languages
				.getDiagnostics(configUri)
				.filter(
					(diagnostic) =>
						diagnostic.code === "unknown-key" ||
						diagnostic.code === "deprecated-key",
				);
		while (configDiagnostics().length < count && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		return configDiagnostics();
	};

	/** Tombi reports the unknown keys itself, from the same schema */
	const hasTombi = () => !!vscode.extensions.getExtension("tombi-toml.tombi");

	const summarize = () =>
		vscode.languages
			.getDiagnostics(configUri)
			.filter(
				(diagnostic) =>
					diagnostic.code === "unknown-key" ||
					diagnostic.code === "deprecated-key",
			)
			.map((diagnostic) => ({
				line: diagnostic.range.start.line,
				character: diagnostic.range.start.character,
				message: diagnostic.message,
				severity: diagnostic.severity,
			}))
			.sort((a, b) => a.line - b.line);

	test("reports the unknown and deprecated keys of mise.toml", async () => {
		const deprecated = {
			line: 1,
			character: 0,
			message:
				"`env_path` is deprecated: use env._.path instead. This will be removed in mise 2027.4.0.",
			severity: vscode.DiagnosticSeverity.Information,
		};
		// mise's diagnostics come first, and leave once Tombi reports the same key
		const expected = hasTombi()
			? [deprecated]
			: [
					deprecated,
					{
						line: 4,
						character: 0,
						message:
							"mise does not read `settings.experimantal`. Did you mean `experimental`?",
						severity: vscode.DiagnosticSeverity.Warning,
					},
					{
						line: 8,
						character: 0,
						message:
							"mise does not read `tasks.build.depnds`. Did you mean `depends`?",
						// mise refuses to load the file
						severity: vscode.DiagnosticSeverity.Error,
					},
				];
		const deadline = Date.now() + DIAGNOSTICS_DEADLINE_MS;
		while (
			JSON.stringify(summarize()) !== JSON.stringify(expected) &&
			Date.now() < deadline
		) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		assert.deepEqual(summarize(), expected);
	});

	test("offers to change an unknown key to the one mise suggests", async () => {
		// once mise explained the file
		await waitForDiagnostics(1);
		// code actions are only computed for an open document
		await vscode.workspace.openTextDocument(configUri);

		// on `experimantal`, whoever reports it
		const keyRange = new vscode.Range(4, 0, 4, "experimantal".length);
		const actions =
			(await vscode.commands.executeCommand<vscode.CodeAction[]>(
				"vscode.executeCodeActionProvider",
				configUri,
				keyRange,
				vscode.CodeActionKind.QuickFix.value,
			)) ?? [];
		const fix = actions.find(
			(action) => action.title === "Change to `experimental`",
		);
		assert.ok(
			fix,
			`Expected the quick fix, got: ${actions.map((a) => a.title).join(", ")}`,
		);
		// not applied: the fixture stays as it is
		const [uri, edits] = fix.edit?.entries()[0] ?? [];
		const edit = edits?.[0];
		assert.equal(uri?.toString(), configUri.toString());
		assert.equal(edit?.newText, "experimental");
		assert.deepEqual(
			[edit?.range.start.character, edit?.range.end.character],
			[0, "experimantal".length],
		);
	});

	test("checks a config file of a subfolder once it is open", async () => {
		const subfolderUri = vscode.Uri.joinPath(
			configUri,
			"..",
			"backend",
			"mise.toml",
		);
		const deprecations = () =>
			vscode.languages
				.getDiagnostics(subfolderUri)
				.filter((diagnostic) => diagnostic.code === "deprecated-key")
				.map((diagnostic) => diagnostic.message);
		// mise does not load it from the workspace root
		assert.deepEqual(deprecations(), []);

		await vscode.workspace.openTextDocument(subfolderUri);
		const deadline = Date.now() + DIAGNOSTICS_DEADLINE_MS;
		while (!deprecations().length && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		assert.deepEqual(deprecations(), [
			"`env_file` is deprecated: use env._.file instead. This will be removed in mise 2027.4.0.",
		]);
	});
});
