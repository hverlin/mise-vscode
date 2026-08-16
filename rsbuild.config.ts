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
		// rsbuild defaults the node target to ESM output and no minification.
		// vscode loads the extension entry with require(), and the bundle ships
		// in the vsix, so both defaults have to be turned back off.
		module: false,
		minify: true,
		externals: { vscode: "commonjs vscode" },
	},
});
