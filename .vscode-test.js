const { defineConfig } = require("@vscode/test-cli");
const path = require("node:path");
const fixturesPath = path.join(__dirname, "src/e2e-tests/fixtures/");

// MISE_CEILING_PATHS stops mise from traversing above the fixtures directory,
// so the workspaces under test never inherit this repository's own mise config.
// Ceiling paths are exclusive: configs at the workspace root are still loaded.
// MISE_LOCKED=0 overrides the CI-wide locked mode: the fixtures have no
// lockfile, and locked mode would refuse to resolve their tools.
module.exports = defineConfig([
	{
		label: "default",
		files: "src/e2e-tests/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "task-execution-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
		},
		installExtensions: ["tombi-toml.tombi"],
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "tool-versions",
		files: "src/e2e-tests/tool-versions/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "tool-versions-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			// Pre-trust the fixture .tool-versions so tool resolution never
			// blocks on the trust dialog in CI.
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "bootstrap",
		files: "src/e2e-tests/bootstrap/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "bootstrap-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// Keep the machine's real global config (tools, bootstrap sections)
			// out of the tests so results match between dev machines and CI.
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"bootstrap-workspace",
				"global-config.toml",
			),
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "command-injection",
		files: "src/e2e-tests/command-injection/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "command-injection-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "projects",
		files: "src/e2e-tests/projects/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "projects-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// Keep the machine's own tracked configs and global config out of the
			// projects view so results match between dev machines and CI.
			MISE_STATE_DIR: path.join(fixturesPath, "projects-workspace", ".state"),
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"projects-workspace",
				"global-config.toml",
			),
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
	{
		label: "custom-extensions",
		files: "src/e2e-tests/custom-extensions/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "custom-extensions-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
			// Keep the machine's real global config out of the tests, and keep the
			// tools installed by the suite out of the machine's mise data dir.
			MISE_GLOBAL_CONFIG_FILE: path.join(
				fixturesPath,
				"custom-extensions-workspace",
				"global-config.toml",
			),
			MISE_DATA_DIR: path.join(
				fixturesPath,
				"custom-extensions-workspace",
				".mise-data",
			),
			MISE_CACHE_DIR: path.join(
				fixturesPath,
				"custom-extensions-workspace",
				".mise-cache",
			),
		},
		// foxundermoon.shell-format is the target extension under test: its
		// `shellformat.path` setting is window-scoped, so the extension is
		// allowed to write it to the workspace settings.
		installExtensions: ["foxundermoon.shell-format"],
		mocha: {
			require: ["tsx/cjs"],
			timeout: 120_000,
		},
	},
	{
		label: "monorepo",
		files: "src/e2e-tests/monorepo/*.e2e.ts",
		workspaceFolder: path.join(fixturesPath, "monorepo-workspace"),
		env: {
			MISE_CEILING_PATHS: fixturesPath,
			MISE_LOCKED: "0",
			// Pre-trust the fixture configs (including subproject configs) so the
			// extension never blocks on the trust dialog in CI.
			MISE_TRUSTED_CONFIG_PATHS: fixturesPath,
		},
		mocha: {
			require: ["tsx/cjs"],
			timeout: 60_000,
		},
	},
]);
