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
			"mise.reloadConfiguration",
			"mise.refreshEntry",
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
				// [bootstrap.files] and [bootstrap.directories] merge across config
				// files, so the global config contributes to the same section
				fixturePath(".mise-vscode-e2e-global-dir"),
				fixturePath(".mise-vscode-e2e-file.conf"),
				fixturePath(".mise-vscode-e2e-global.conf"),
				fixturePath(".mise-vscode-e2e-secret.conf"),
			],
			"directories and files share one section, in mise's order",
		);
		assert.equal(files.entries[3]?.state, "create");
		// the secret this file templates is never set, so mise cannot inspect it
		assert.equal(files.entries[5]?.state, "unknown");

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
				{ kind: "directory", name: fixturePath(".mise-vscode-e2e-global-dir") },
				{ kind: "file", name: fixturePath(".mise-vscode-e2e-file.conf") },
				{ kind: "file", name: fixturePath(".mise-vscode-e2e-global.conf") },
				{ kind: "file", name: fixturePath(".mise-vscode-e2e-secret.conf") },
			],
		);
		assert.deepEqual(plan.summary, {
			create: 5,
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

	test("shows a code lens on every bootstrap section of the document", async () => {
		const lenses = (
			(await vscode.commands.executeCommand<vscode.CodeLens[]>(
				"vscode.executeCodeLensProvider",
				miseTomlDocument.uri,
			)) ?? []
		).filter((lens) => lens.command?.command === "mise.showBootstrap");

		// one lens per table declared in the fixture, anchored on its header
		const byTable = new Map(
			lenses.map((lens) => [
				lens.command?.arguments?.[0] as string,
				{ title: lens.command?.title ?? "", line: lens.range.start.line },
			]),
		);

		assert.deepEqual(
			[...byTable.keys()].sort(),
			[
				"bootstrap.directories",
				"bootstrap.files",
				// the friendly shorthands are reported as com.apple.* defaults, but
				// they are written here, so their lenses belong on these tables
				"bootstrap.macos.dock",
				"bootstrap.macos.finder",
				"bootstrap.macos.defaults.com.example.mise-vscode-e2e",
				"bootstrap.repos",
				"bootstrap.secrets",
				"dotfiles",
			].sort(),
			"every bootstrap table of the fixture should get a lens",
		);

		assert.equal(
			byTable.get("bootstrap.macos.finder")?.line,
			lineOf("[bootstrap.macos.finder]"),
			"the shorthand lens should sit on the shorthand table, not on defaults",
		);
		// `dock.autohide` is a dotted key inside [bootstrap.macos]: the lens has
		// to anchor on that header, not on the line the key happens to be written
		// on, or it renders in the middle of the table
		assert.equal(
			byTable.get("bootstrap.macos.dock")?.line,
			lineOf("[bootstrap.macos]"),
			"a dotted-key shorthand should anchor on its enclosing table header",
		);

		assert.equal(
			byTable.get("bootstrap.repos")?.line,
			lineOf("[bootstrap.repos]"),
			"the lens should sit on the table header",
		);

		// the fixture entries all point at resources that do not exist
		assert.match(
			byTable.get("bootstrap.repos")?.title ?? "",
			/^\$\(warning\) Bootstrap · 1\/1 pending$/,
		);
		assert.match(
			byTable.get("bootstrap.secrets")?.title ?? "",
			/^\$\(warning\) Bootstrap · 1\/1 pending$/,
		);
		// two files here, one of which mise cannot inspect without the secret: an
		// uninspectable entry is not actionable, so it must not be reported. The
		// global config declares a third file, which merges into the same status
		// section and must not be counted by this document's lens
		assert.match(
			byTable.get("bootstrap.files")?.title ?? "",
			/^\$\(warning\) Bootstrap · 1\/2 pending$/,
		);
		// likewise: two directories here, a third in the global config
		assert.match(
			byTable.get("bootstrap.directories")?.title ?? "",
			/^\$\(warning\) Bootstrap · 2\/2 pending$/,
		);
	});

	test("each config file gets a lens for its own entries only", async () => {
		// the global config declares one file and one directory of its own, which
		// merge into the same status sections as the workspace ones: its lenses
		// must report only its two entries, not all six
		const globalConfig = await vscode.workspace.openTextDocument(
			path.join(workspaceRoot, "global-config.toml"),
		);

		const lenses = (
			(await vscode.commands.executeCommand<vscode.CodeLens[]>(
				"vscode.executeCodeLensProvider",
				globalConfig.uri,
			)) ?? []
		).filter((lens) => lens.command?.command === "mise.showBootstrap");

		assert.deepEqual(
			lenses.map((lens) => lens.command?.arguments?.[0]).sort(),
			["bootstrap.directories", "bootstrap.files"],
			"only the sections the global config declares should get a lens",
		);
		for (const lens of lenses) {
			assert.match(
				lens.command?.title ?? "",
				/^\$\(warning\) Bootstrap · 1\/1 pending$/,
				`${lens.command?.arguments?.[0]} should count one entry`,
			);
			assert.match(
				lens.command?.tooltip ?? "",
				/mise-vscode-e2e-global/,
				"the tooltip should list the entry of this document",
			);
		}
	});
});
