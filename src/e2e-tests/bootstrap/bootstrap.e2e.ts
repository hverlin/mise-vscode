import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { MiseService } from "../../miseService";
import { getBootstrapSections } from "../../utils/bootstrapUtils";

/**
 * Bootstrap e2e tests. Everything here is read-only and machine-agnostic:
 * `mise bootstrap` is never executed (only status, `bootstrap plan` — which is
 * a preview and never applies anything — definition navigation and command
 * registration are exercised), the fixture entries point at resources that do
 * not exist anywhere, and the suite isolates the machine's global mise config
 * via MISE_GLOBAL_CONFIG_FILE (see .vscode-test.js), so results are identical
 * on macOS (dev machines) and Linux (CI).
 */
suite("Bootstrap Test Suite", function () {
	this.timeout(30_000);

	let workspaceRoot: string;
	let miseTomlDocument: vscode.TextDocument;

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

	// mise reports resource paths expanded, the fixture declares them with `~`
	const fixturePath = (name: string) => path.join(os.homedir(), name);

	const lineOf = (text: string): number => {
		for (let i = 0; i < miseTomlDocument.lineCount; i++) {
			if (miseTomlDocument.lineAt(i).text.includes(text)) {
				return i;
			}
		}
		assert.fail(`Line containing "${text}" not found in fixture`);
	};

	const openDefinition = async (tablePath: string[], key: string) => {
		await vscode.commands.executeCommand("mise.openBootstrapEntryDefinition", {
			label: key,
			state: "missing",
			definition: { tablePath, key },
		});
		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, "An editor should be opened");
		return editor;
	};

	suiteSetup(async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(root, "Workspace root should be available");
		workspaceRoot = root;

		const extension = vscode.extensions.getExtension("hverlin.mise-vscode");
		assert.ok(extension, "Extension should be available");
		await extension.activate();

		miseTomlDocument = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "mise.toml"),
		);
	});

	test("bootstrap commands are registered", async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const command of [
			"mise.runBootstrap",
			"mise.runBootstrapDryRun",
			"mise.runBootstrapPlan",
			"mise.showBootstrap",
			"mise.openBootstrapEntryDefinition",
		]) {
			assert.ok(
				commands.includes(command),
				`Command ${command} should be registered`,
			);
		}
	});

	test("navigates to a [bootstrap.repos] entry declaration", async () => {
		const editor = await openDefinition(
			["bootstrap", "repos"],
			"vendor/mise-e2e-repo",
		);

		assert.ok(
			editor.document.fileName.endsWith("mise.toml"),
			`Should open mise.toml, got ${editor.document.fileName}`,
		);
		assert.equal(
			editor.selection.start.line,
			lineOf('"vendor/mise-e2e-repo"'),
			"Selection should be on the repo declaration line",
		);
	});

	test("navigates to a [dotfiles] entry declaration", async () => {
		const editor = await openDefinition(
			["dotfiles"],
			"~/.mise-vscode-e2e-dotfile",
		);

		assert.equal(
			editor.selection.start.line,
			lineOf('"~/.mise-vscode-e2e-dotfile"'),
			"Selection should be on the dotfile declaration line",
		);
	});

	test("navigates to a [bootstrap.macos.defaults] key declaration", async () => {
		const editor = await openDefinition(
			["bootstrap", "macos", "defaults", "com.example.mise-vscode-e2e"],
			"ExampleKey",
		);

		assert.equal(
			editor.selection.start.line,
			lineOf("ExampleKey"),
			"Selection should be on the defaults key line",
		);
	});

	test("navigates to a [bootstrap.macos.finder] shorthand declaration", async () => {
		// mise resolves `[bootstrap.macos.finder] show_pathbar` to
		// `com.apple.finder ShowPathbar` in status output; navigation must find
		// the shorthand declaration via the alternates
		await vscode.commands.executeCommand("mise.openBootstrapEntryDefinition", {
			label: "com.apple.finder ShowPathbar",
			state: "unset",
			definition: {
				tablePath: ["bootstrap", "macos", "defaults", "com.apple.finder"],
				key: "ShowPathbar",
			},
			alternates: [
				{ tablePath: ["bootstrap", "macos", "finder"], key: "show_pathbar" },
			],
		});
		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, "An editor should be opened");

		assert.equal(
			editor.selection.start.line,
			lineOf("show_pathbar"),
			"Selection should be on the shorthand declaration line",
		);
	});

	test("falls back to the enclosing table when the key does not exist", async () => {
		const editor = await openDefinition(
			["bootstrap", "macos", "defaults", "com.example.mise-vscode-e2e"],
			"KeyThatDoesNotExist",
		);

		assert.equal(
			editor.selection.start.line,
			lineOf('"com.example.mise-vscode-e2e"'),
			"Selection should fall back to the domain table declaration",
		);
	});

	test("does not throw for an entry declared nowhere", async () => {
		await vscode.commands.executeCommand("mise.openBootstrapEntryDefinition", {
			label: "ghost",
			state: "missing",
			definition: { tablePath: ["bootstrap", "repos"], key: "does/not-exist" },
		});
	});

	test("show bootstrap status webview opens without error", async () => {
		await vscode.commands.executeCommand("mise.showBootstrap");
	});

	test("status reports the declarative resource sections", async () => {
		const miseService = await createMiseService();

		const status = await miseService.getBootstrapStatus();
		assert.ok(status, "bootstrap status should be returned");

		const sections = getBootstrapSections(status);
		const byLabel = (label: string) =>
			sections.find((section) => section.label === label);

		const files = byLabel("Files");
		assert.ok(files, "Files section should be present");
		assert.deepEqual(
			files.entries.map((entry) => entry.label),
			[
				fixturePath(".mise-vscode-e2e-dir"),
				fixturePath(".mise-vscode-e2e-dir-two"),
				fixturePath(".mise-vscode-e2e-file.conf"),
				fixturePath(".mise-vscode-e2e-secret.conf"),
			],
			"directories and files share one section, in mise's order",
		);
		assert.equal(files.entries[2]?.state, "create");
		// the secret this file templates is never set, so mise cannot inspect it
		assert.equal(files.entries[3]?.state, "unknown");

		const secrets = byLabel("Secrets");
		assert.ok(secrets, "Secrets section should be present");
		assert.equal(secrets.entries[0]?.label, "e2e_token");
		assert.equal(
			secrets.entries[0]?.description,
			"MISE_VSCODE_E2E_SECRET_THAT_IS_NEVER_SET",
		);
		assert.equal(secrets.entries[0]?.state, "missing");

		// the fixture declares no services, firewall, compose or accounts, so
		// those sections stay out of the view on every platform
		for (const label of ["Services", "Firewall", "Compose", "Accounts"]) {
			assert.equal(byLabel(label), undefined, `${label} should be absent`);
		}
	});

	test("plan previews the changes without applying them", async () => {
		const miseService = await createMiseService();
		assert.ok(
			await miseService.isBootstrapPlanAvailable(),
			"`mise bootstrap plan` requires mise 2026.8.2 or later",
		);

		const plan = await miseService.getBootstrapPlan();
		assert.ok(plan, "bootstrap plan should be returned");

		assert.deepEqual(
			plan.resources.map((resource) => resource.id),
			[
				{ kind: "directory", name: fixturePath(".mise-vscode-e2e-dir") },
				{ kind: "directory", name: fixturePath(".mise-vscode-e2e-dir-two") },
				{ kind: "file", name: fixturePath(".mise-vscode-e2e-file.conf") },
				{ kind: "file", name: fixturePath(".mise-vscode-e2e-secret.conf") },
			],
		);
		assert.deepEqual(plan.summary, {
			create: 3,
			update: 0,
			remove: 0,
			unchanged: 0,
			unknown: 1,
		});

		// a plan is a preview: nothing it lists may exist afterwards
		for (const resource of plan.resources) {
			assert.equal(
				await vscode.workspace.fs.stat(vscode.Uri.file(resource.id.name)).then(
					() => true,
					() => false,
				),
				false,
				`${resource.id.name} should not have been created`,
			);
		}
	});

	// status reports resource paths expanded, so navigation has to find the `~`
	// form they are declared with. Both tests target the second declaration of
	// their kind: the enclosing-table fallback always resolves to the first, so
	// they fail unless the expanded path is really matched back to its `~` form.
	test("navigates to a [bootstrap.files] declaration from the expanded path", async () => {
		const editor = await openDefinition(
			["bootstrap", "files"],
			fixturePath(".mise-vscode-e2e-secret.conf"),
		);

		assert.equal(
			editor.selection.start.line,
			lineOf('"~/.mise-vscode-e2e-secret.conf"'),
			"Selection should be on the file declaration line",
		);
	});

	test("navigates to a [bootstrap.directories] declaration from the expanded path", async () => {
		const editor = await openDefinition(
			["bootstrap", "directories"],
			fixturePath(".mise-vscode-e2e-dir-two"),
		);

		assert.equal(
			editor.selection.start.line,
			lineOf('"~/.mise-vscode-e2e-dir-two"'),
			"Selection should be on the directory declaration line",
		);
	});

	test("navigates to a [bootstrap.secrets] declaration", async () => {
		const editor = await openDefinition(["bootstrap", "secrets"], "e2e_token");

		assert.equal(
			editor.selection.start.line,
			lineOf("e2e_token ="),
			"Selection should be on the secret declaration line",
		);
	});
});
