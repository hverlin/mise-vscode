import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
	plugins: [pluginReact()],
	dev: {
		writeToDisk: true,
		hmr: false,
		cliShortcuts: false,
		client: { port: 9988, host: "127.0.0.1" },
	},
	server: { port: 9988 },
	source: {
		entry: {
			index: "./src/webviews/index.tsx",
		},
	},
	security: { nonce: "mise-vscode" },
	output: {
		distPath: {
			root: "./dist/webviews",
		},
		sourceMap: { js: "source-map" },
		externals: { vscode: "commonjs vscode" },
	},
});
