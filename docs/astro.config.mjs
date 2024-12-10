import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	site: "https://hverlin.github.io/mise-vscode/",
	base: "mise-vscode",
	integrations: [
		starlight({
			title: "VSCode mise",
			social: {
				github: "https://github.com/hverlin/mise-vscode",
			},
		}),
	],
});
