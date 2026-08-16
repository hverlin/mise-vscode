import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { MISE_CONFIGURE_ALL_SDK_PATHS } from "../../commands";

const execFileAsync = promisify(execFile);

const PKL_EXTENSION_ID = "Pkl.pkl-vscode";

/** every setting key the suite writes, for cleanup */
const ALL_SETTING_KEYS = [
	"jdk.jdkhome",
	"java.jdt.ls.java.home",
	"java.import.gradle.java.home",
	"sonarlint.ls.javaHome",
	"sonarlint.pathToNodeExecutable",
	"pkl.cli.path",
	"pkl.lsp.java.path",
	"dotnetAcquisitionExtension.sharedExistingDotnetPath",
];

/**
 * The rows of the supported-extensions docs table
 * (docs/src/content/docs/reference/Supported-extensions.md) whose tool is a
 * full SDK: java, dotnet and pkl. They are separated from the
 * supported-extensions suite because each install is hundreds of megabytes.
 *
 * The salesforce apex row is left uncovered: it writes
 * `salesforcedx-vscode-apex.java.home` through the same code path as the other
 * java rows, and its extension pulls the salesforcedx dependency chain in.
 *
 * Beyond the settings themselves, this covers the two conditional rows of the
 * table, which are written only when the tool they name is installed through
 * mise: `pkl.lsp.java.path` and `sonarlint.ls.javaHome` need java, and
 * `sonarlint.pathToNodeExecutable` needs node, which the fixture leaves out on
 * purpose.
 */
suite("SDK extensions (java, dotnet, pkl)", function () {
	// installs a JDK and the dotnet SDK on a cold cache
	this.timeout(900_000);

	let workspaceRoot: string;
	let javaHome: string;

	const shimsSegment = path.join(".mise-data", "shims");
	const symLinksSegment = path.join(".vscode", "mise-tools");

	/**
	 * The suite only asserts the pkl rows when the extension could be
	 * installed. It is not on the marketplace, so `.vscode-test.js` installs a
	 * vsix fetched by `node --run fetch-pkl-vsix` and reports here whether it
	 * found one.
	 */
	const pklVsixInstalled = process.env.MISE_E2E_PKL_VSIX === "1";

	const workspaceValue = <T>(key: string): T | undefined =>
		vscode.workspace.getConfiguration().inspect<T>(key)?.workspaceValue;

	const clearAllSettings = async () => {
		const config = vscode.workspace.getConfiguration();
		for (const key of ALL_SETTING_KEYS) {
			await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
		}
	};

	/** `java -version` writes to stderr */
	const javaVersion = async (javaBin: string) => {
		const { stderr } = await execFileAsync(javaBin, ["-version"], {
			cwd: workspaceRoot,
		});
		return stderr;
	};

	const assertIsJavaHome = async (value: string | undefined, key: string) => {
		assert.ok(value, `${key} should be configured`);
		assert.equal(
			value,
			javaHome,
			`${key} should be the java install path (the JDK home), got ${value}`,
		);
		// a home, not a binary: the extensions append `bin/java` themselves
		const javaBin = path.join(value, "bin", "java");
		assert.ok(
			existsSync(javaBin),
			`${key} should contain bin/java: ${javaBin}`,
		);
		assert.match(
			await javaVersion(javaBin),
			/21\.0\.12/,
			`${key} should be the version pinned by the fixture`,
		);
	};

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		const missing = [
			"oracle.oracle-java",
			"redhat.java",
			"vscjava.vscode-gradle",
			"SonarSource.sonarlint-vscode",
			"ms-dotnettools.vscode-dotnet-runtime",
			...(pklVsixInstalled ? [PKL_EXTENSION_ID] : []),
		].filter((extensionId) => !vscode.extensions.getExtension(extensionId));
		assert.deepEqual(
			missing,
			[],
			"Extensions from installExtensions in .vscode-test.js should be installed",
		);

		if (!pklVsixInstalled) {
			console.log(
				`${PKL_EXTENSION_ID} is not installed, skipping the pkl rows. Run \`node --run fetch-pkl-vsix\` to cover them.`,
			);
		}

		await execFileAsync("mise", ["install"], {
			cwd: workspaceRoot,
			maxBuffer: 32 * 1024 * 1024,
		});

		const { stdout } = await execFileAsync("mise", ["where", "java"], {
			cwd: workspaceRoot,
		});
		javaHome = stdout.trim();

		await clearAllSettings();
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
	});

	suiteTeardown(async () => {
		await vscode.workspace
			.getConfiguration("mise")
			.update(
				"configureExtensionsUseSymLinks",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		await clearAllSettings();
	});

	test("jdk.jdkhome is the JDK home (oracle.oracle-java)", async () => {
		await assertIsJavaHome(
			workspaceValue<string>("jdk.jdkhome"),
			"jdk.jdkhome",
		);
	});

	test("java.jdt.ls.java.home is the JDK home (redhat.java)", async () => {
		await assertIsJavaHome(
			workspaceValue<string>("java.jdt.ls.java.home"),
			"java.jdt.ls.java.home",
		);
	});

	test("java.import.gradle.java.home is the JDK home (vscjava.vscode-gradle)", async () => {
		await assertIsJavaHome(
			workspaceValue<string>("java.import.gradle.java.home"),
			"java.import.gradle.java.home",
		);
	});

	test("sonarlint.ls.javaHome is the JDK home (SonarSource.sonarlint-vscode)", async () => {
		await assertIsJavaHome(
			workspaceValue<string>("sonarlint.ls.javaHome"),
			"sonarlint.ls.javaHome",
		);
	});

	test("sonarlint.pathToNodeExecutable stays unset when node is not a mise tool", () => {
		assert.equal(
			workspaceValue("sonarlint.pathToNodeExecutable"),
			undefined,
			"the docs table writes this row only when node is installed through mise, and the fixture has no node",
		);
	});

	test("dotnetAcquisitionExtension.sharedExistingDotnetPath runs dotnet (ms-dotnettools.vscode-dotnet-runtime)", async () => {
		const dotnetBin = workspaceValue<string>(
			"dotnetAcquisitionExtension.sharedExistingDotnetPath",
		);
		assert.ok(dotnetBin, "the dotnet path should be configured");
		assert.equal(path.basename(dotnetBin), "dotnet");
		assert.ok(
			dotnetBin.includes(shimsSegment),
			`the dotnet path should be a shim, got ${dotnetBin}`,
		);

		const { stdout } = await execFileAsync(dotnetBin, ["--version"], {
			cwd: workspaceRoot,
		});
		assert.match(
			stdout,
			/^10\.0\./,
			`dotnet should be the version pinned by the fixture: ${stdout}`,
		);
	});

	test("pkl.cli.path runs pkl, matched by its registry name (Pkl.pkl-vscode)", async function () {
		if (!pklVsixInstalled) {
			this.skip();
		}

		// the extension entry lists `aqua:apple/pkl` while the fixture declares
		// `pkl`, so a match proves the registry name expansion
		const pklBin = workspaceValue<string>("pkl.cli.path");
		assert.ok(pklBin, "pkl.cli.path should be configured");
		assert.equal(path.basename(pklBin), "pkl");
		assert.ok(
			pklBin.includes(shimsSegment),
			`pkl.cli.path should be a shim, got ${pklBin}`,
		);

		const { stdout } = await execFileAsync(pklBin, ["--version"], {
			cwd: workspaceRoot,
		});
		assert.match(
			stdout,
			/0\.32\.1/,
			`pkl should be the version pinned by the fixture: ${stdout}`,
		);
	});

	test("pkl.lsp.java.path is the java binary, not the JDK home (Pkl.pkl-vscode)", async function () {
		if (!pklVsixInstalled) {
			this.skip();
		}

		const javaBin = workspaceValue<string>("pkl.lsp.java.path");
		assert.ok(javaBin, "pkl.lsp.java.path should be configured");
		assert.equal(
			path.basename(javaBin),
			"java",
			`pkl.lsp.java.path takes the binary, unlike the jdkhome rows, got ${javaBin}`,
		);
		assert.ok(
			javaBin.includes(shimsSegment),
			`pkl.lsp.java.path should be a shim, got ${javaBin}`,
		);
		assert.match(await javaVersion(javaBin), /21\.0\.12/);
	});

	test("symlink mode moves the JDK home into the symlink folder and keeps pkl.lsp.java.path on its shim", async () => {
		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		await miseConfiguration.update(
			"configureExtensionsUseSymLinks",
			true,
			vscode.ConfigurationTarget.Workspace,
		);

		try {
			await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

			const jdkHome = workspaceValue<string>("jdk.jdkhome");
			assert.ok(jdkHome, "jdk.jdkhome should be configured");
			assert.ok(
				jdkHome.includes(symLinksSegment),
				`jdk.jdkhome should be in the symlink folder, got ${jdkHome}`,
			);

			// the configured value starts with ${workspaceFolder}; the link itself
			// has to exist on disk and still be a usable JDK home
			const linkPath = path.join(
				workspaceRoot,
				symLinksSegment,
				path.basename(jdkHome),
			);
			assert.ok(existsSync(linkPath), `Symlink should exist at ${linkPath}`);
			assert.match(
				await javaVersion(path.join(linkPath, "bin", "java")),
				/21\.0\.12/,
				"the symlinked JDK home should run the pinned java",
			);

			if (pklVsixInstalled) {
				const pklJavaBin = workspaceValue<string>("pkl.lsp.java.path");
				assert.ok(pklJavaBin, "pkl.lsp.java.path should be configured");
				assert.ok(
					pklJavaBin.includes(shimsSegment),
					`pkl.lsp.java.path is never symlinked, so it should keep its shim, got ${pklJavaBin}`,
				);
			}
		} finally {
			await miseConfiguration.update(
				"configureExtensionsUseSymLinks",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
	});
});
