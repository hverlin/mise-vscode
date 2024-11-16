import { defineConfig } from "@rsbuild/core";

export default defineConfig({
	dev: {
		writeToDisk: true,
		hmr: false,
		cliShortcuts: false,
	},
	server: { port: 9987 },
	source: { entry: { extension: "./src/extension.ts" } },
	output: {
		cleanDistPath: false,
		sourceMap: { js: "source-map" },
		target: "node",
		externals: { vscode: "commonjs vscode" },
	},
});
