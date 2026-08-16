import * as assert from "node:assert";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { MISE_CONFIGURE_ALL_SDK_PATHS } from "../../commands";

const execFileAsync = promisify(execFile);

type DocumentedSetting = {
	/** row of the docs table this asserts */
	extensionId: string;
	key: string;
	bin: string;
	/** some extensions take a list of candidate paths instead of one path */
	shape?: "string" | "array";
	/**
	 * shims are the default; the rows flagged "does not work with shims" in the
	 * docs resolve to the tool install path instead
	 */
	usesShims?: boolean;
	/**
	 * args proving the configured binary runs; null skips the run (bazelisk
	 * downloads a bazel on first invocation)
	 */
	versionArgs?: string[] | null;
};

const DOCUMENTED_SETTINGS: DocumentedSetting[] = [
	{
		extensionId: "timonwong.shellcheck",
		key: "shellcheck.executablePath",
		bin: "shellcheck",
	},
	{
		extensionId: "foxundermoon.shell-format",
		key: "shellformat.path",
		bin: "shfmt",
	},
	{
		extensionId: "signageos.signageos-vscode-sops",
		key: "sops.binPath",
		bin: "sops",
	},
	{
		extensionId: "exiasr.hadolint",
		key: "hadolint.hadolintPath",
		bin: "hadolint",
	},
	{
		extensionId: "bufbuild.vscode-buf",
		key: "buf.commandLine.path",
		bin: "buf",
	},
	{ extensionId: "twxs.cmake", key: "cmake.cmakePath", bin: "cmake" },
	{
		extensionId: "sumneko.lua",
		key: "Lua.misc.executablePath",
		bin: "lua-language-server",
	},
	{ extensionId: "denoland.vscode-deno", key: "deno.path", bin: "deno" },
	{ extensionId: "oven.bun-vscode", key: "bun.runtime", bin: "bun" },
	{
		extensionId: "charliermarsh.ruff",
		key: "ruff.path",
		bin: "ruff",
		shape: "array",
	},
	{
		extensionId: "astral-sh.ty",
		key: "ty.path",
		bin: "ty",
		shape: "array",
	},
	{
		extensionId: "ms-python.python",
		key: "python.defaultInterpreterPath",
		bin: "python",
		usesShims: false,
	},
	{
		extensionId: "ziglang.vscode-zig",
		key: "zig.path",
		bin: "zig",
		usesShims: false,
		versionArgs: ["version"],
	},
	{
		extensionId: "ziglang.vscode-zig",
		key: "zig.zls.path",
		bin: "zls",
		usesShims: false,
	},
	{
		extensionId: "bazelbuild.vscode-bazel",
		key: "bazel.executable",
		bin: "bazelisk",
		usesShims: false,
		versionArgs: null,
	},
	{
		extensionId: "bazelbuild.vscode-bazel",
		key: "bazel.buildifierExecutable",
		bin: "buildifier",
		usesShims: false,
	},
];

/** every key the suite writes, for cleanup */
const ALL_SETTING_KEYS = [
	...DOCUMENTED_SETTINGS.map((setting) => setting.key),
	"ruff.interpreter",
	"debug.javascript.defaultRuntimeExecutable",
	"biome.lsp.bin",
];

/**
 * `Mise: Configure all SDK paths` against every extension of the
 * supported-extensions docs table
 * (docs/src/content/docs/reference/Supported-extensions.md) that installs
 * from a prebuilt binary. The fixture mise.toml declares each tool and
 * .vscode-test.js installs each target extension, so the assertions run
 * against the real marketplace extensions and the real setting keys the table
 * documents, including its caveats: rows that cannot use shims resolve to the
 * install path, rows that cannot use symlinks keep their shim in symlink
 * mode, and rows on the default ignore list stay untouched.
 *
 * The rows whose tool is a full SDK are covered by the sdk-extensions suite
 * (java, dotnet, pkl), and go has its own suite. The rows left uncovered need
 * a vendor SDK or a compile from source (dart, flutter, swift, erlang, julia,
 * php), another tool to be installed first (ginkgo), or a set of npm-installed
 * tools (oxc).
 */
suite("Supported extensions (docs table)", function () {
	// downloads over a dozen tools on a cold cache
	this.timeout(600_000);

	let workspaceRoot: string;

	const shimsSegment = path.join(".mise-data", "shims");
	const symLinksSegment = path.join(".vscode", "mise-tools");

	const workspaceValue = <T>(key: string): T | undefined =>
		vscode.workspace.getConfiguration().inspect<T>(key)?.workspaceValue;

	const clearAllSettings = async () => {
		const config = vscode.workspace.getConfiguration();
		for (const key of ALL_SETTING_KEYS) {
			await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
		}
	};

	const assertConfiguredBinary = (
		setting: DocumentedSetting,
	): { binPath: string } => {
		const { key, bin, shape, usesShims = true } = setting;

		let binPath: string | undefined;
		if (shape === "array") {
			const value = workspaceValue<string[]>(key);
			assert.ok(value, `${key} should be configured`);
			assert.equal(value.length, 1, `${key} should hold one path`);
			binPath = value[0];
		} else {
			binPath = workspaceValue<string>(key);
		}

		assert.ok(binPath, `${key} should be configured`);
		assert.equal(
			path.basename(binPath),
			bin,
			`${key} should point at ${bin}, got ${binPath}`,
		);
		if (usesShims) {
			assert.ok(
				binPath.includes(shimsSegment),
				`${key} should point at a shim, got ${binPath}`,
			);
		} else {
			assert.ok(
				!binPath.includes(shimsSegment),
				`${key} does not support shims (docs table comment), got ${binPath}`,
			);
		}
		assert.ok(
			existsSync(binPath),
			`${key} should point at an existing file: ${binPath}`,
		);

		return { binPath };
	};

	suiteSetup(async () => {
		workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
		assert.ok(workspaceRoot, "Workspace root should be available");

		const requiredExtensions = [
			...new Set(DOCUMENTED_SETTINGS.map((setting) => setting.extensionId)),
			"biomejs.biome",
			// built into VS Code, covers the NodeJS row
			"ms-vscode.js-debug",
		];
		const missing = requiredExtensions.filter(
			(extensionId) => !vscode.extensions.getExtension(extensionId),
		);
		assert.deepEqual(
			missing,
			[],
			"Extensions from installExtensions in .vscode-test.js should be installed",
		);

		await execFileAsync("mise", ["install"], {
			cwd: workspaceRoot,
			maxBuffer: 32 * 1024 * 1024,
		});

		await clearAllSettings();
		await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);
	});

	suiteTeardown(async () => {
		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		for (const key of [
			"configureExtensionsUseSymLinks",
			"configureExtensionsAutomaticallyIgnoreList",
		]) {
			await miseConfiguration.update(
				key,
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
		await clearAllSettings();
	});

	for (const setting of DOCUMENTED_SETTINGS) {
		test(`${setting.key} points at ${setting.bin} (${setting.extensionId})`, async () => {
			const { binPath } = assertConfiguredBinary(setting);

			if (setting.versionArgs !== null) {
				// proves the configured path is executable, shim or install path
				await execFileAsync(binPath, setting.versionArgs ?? ["--version"], {
					cwd: workspaceRoot,
				});
			}
		});
	}

	test("debug.javascript.defaultRuntimeExecutable points pwa-node at the node shim (ms-vscode.js-debug)", async () => {
		const runtimeExecutable = workspaceValue<Record<string, string>>(
			"debug.javascript.defaultRuntimeExecutable",
		);
		const nodeBin = runtimeExecutable?.["pwa-node"];
		assert.ok(nodeBin, "pwa-node runtime should be configured");
		assert.ok(
			nodeBin.includes(shimsSegment),
			`pwa-node should point at a shim, got ${nodeBin}`,
		);

		const { stdout } = await execFileAsync(nodeBin, ["--version"], {
			cwd: workspaceRoot,
		});
		assert.match(
			stdout,
			/^v26\.7\.0/,
			`The configured node should be the fixture-pinned version: ${stdout}`,
		);
	});

	test("ruff.interpreter points at the python shim (charliermarsh.ruff)", () => {
		const interpreter = workspaceValue<string[]>("ruff.interpreter");
		assert.ok(interpreter, "ruff.interpreter should be configured");
		assert.equal(
			interpreter.length,
			1,
			"ruff.interpreter should hold one path",
		);
		const pythonBin = interpreter[0] as string;
		assert.equal(path.basename(pythonBin), "python");
		assert.ok(
			pythonBin.includes(shimsSegment),
			`ruff.interpreter should point at a shim, got ${pythonBin}`,
		);
		assert.ok(existsSync(pythonBin));
	});

	test("biome stays unconfigured until the default ignore list is cleared (biomejs.biome)", async () => {
		assert.equal(
			workspaceValue("biome.lsp.bin"),
			undefined,
			"biome is on the default configureExtensionsAutomaticallyIgnoreList (docs table comment)",
		);

		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		await miseConfiguration.update(
			"configureExtensionsAutomaticallyIgnoreList",
			[],
			vscode.ConfigurationTarget.Workspace,
		);

		try {
			await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

			const biomeBin = workspaceValue<string>("biome.lsp.bin");
			assert.ok(
				biomeBin,
				"biome.lsp.bin should be configured once the ignore list is cleared",
			);
			assert.ok(
				biomeBin.includes(shimsSegment),
				`biome.lsp.bin should point at a shim, got ${biomeBin}`,
			);
			assert.ok(existsSync(biomeBin));
		} finally {
			await miseConfiguration.update(
				"configureExtensionsAutomaticallyIgnoreList",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
	});

	test("symlink mode routes shellcheck through the symlink folder and keeps hadolint on its shim", async () => {
		const miseConfiguration = vscode.workspace.getConfiguration("mise");
		await miseConfiguration.update(
			"configureExtensionsUseSymLinks",
			true,
			vscode.ConfigurationTarget.Workspace,
		);

		try {
			await vscode.commands.executeCommand(MISE_CONFIGURE_ALL_SDK_PATHS);

			const shellcheckPath = workspaceValue<string>(
				"shellcheck.executablePath",
			);
			assert.ok(shellcheckPath, "shellcheck.executablePath should be set");
			assert.ok(
				shellcheckPath.includes(symLinksSegment),
				`shellcheck supports symlinks, so its path should be in the symlink folder, got ${shellcheckPath}`,
			);
			// the configured value starts with ${workspaceFolder}; the link itself
			// must exist on disk
			const linkPath = path.join(
				workspaceRoot,
				symLinksSegment,
				path.basename(shellcheckPath),
			);
			assert.ok(existsSync(linkPath), `Symlink should exist at ${linkPath}`);

			const hadolintPath = workspaceValue<string>("hadolint.hadolintPath");
			assert.ok(hadolintPath, "hadolint.hadolintPath should be set");
			assert.ok(
				hadolintPath.includes(shimsSegment),
				`hadolint does not support symlinks (docs table comment), so it should keep its shim, got ${hadolintPath}`,
			);
		} finally {
			await miseConfiguration.update(
				"configureExtensionsUseSymLinks",
				undefined,
				vscode.ConfigurationTarget.Workspace,
			);
		}
	});
});
