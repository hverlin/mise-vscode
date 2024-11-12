import { defineConfig } from "@rsbuild/core";

export default defineConfig({
	dev: {
		writeToDisk: true,
		hmr: false,
	},
	server: {},
	source: {
		entry: { extension: "./src/extension.ts" },
	},
	output: {
		sourceMap: { js: "source-map" },
		target: "node",
		externals: {
			vscode: "commonjs vscode",
		},
	},
});
