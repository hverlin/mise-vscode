import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightImageZoom from "starlight-image-zoom";
import starlightLinksValidator from "starlight-links-validator";
import starlightThemeObsidian from "starlight-theme-obsidian";

export default defineConfig({
	site: "https://hverlin.github.io/mise-vscode/",
	base: "mise-vscode",
	integrations: [
		starlight({
			title: "mise | VSCode",
			plugins: [
				starlightLinksValidator({
					exclude: ["http://127.0.0.1:8000/"],
				}),
				starlightImageZoom(),
				starlightThemeObsidian({
					graphConfig: { visibilityRules: [] },
				}),
			],
			customCss: ["./src/styles/global.css"],
			editLink: {
				baseUrl: "https://github.com/hverlin/mise-vscode/tree/main/docs/",
			},
			social: {
				github: "https://github.com/hverlin/mise-vscode",
			},
		}),
	],
});
