const { defineConfig } = require("@vscode/test-cli");
const path = require("node:path");
const fixturesPath = path.join(__dirname, "src/e2e-tests/fixtures/");

module.exports = defineConfig({
	files: "src/e2e-tests/**/*.e2e.ts",
	workspaceFolder: path.join(fixturesPath, "task-execution-workspace"),
	env: {
		MISE_CEILING_PATHS: fixturesPath,
	},
	installExtensions: ["tombi-toml.tombi"],
	mocha: {
		require: ["tsx/cjs"],
		timeout: 60_000,
	},
});
