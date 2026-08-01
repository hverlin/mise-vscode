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
