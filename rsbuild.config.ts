import { defineConfig } from "@rsbuild/core";

export default defineConfig({
	dev: {
		writeToDisk: true,
		hmr: false,
		cliShortcuts: false,
	},
	source: { entry: { extension: "./src/extension.ts" } },
	output: {
		sourceMap: { js: "source-map" },
		target: "node",
		externals: { vscode: "commonjs vscode" },
	},
});
