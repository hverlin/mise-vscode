const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
	files: "src/e2e-tests/**/*.e2e.ts",
	mocha: {
		require: ["tsx/cjs"],
		timeout: 60_000,
	},
});
