import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightImageZoom from "starlight-image-zoom";
import starlightLinksValidator from "starlight-links-validator";
import { extractSettingsDoc } from "./src/plugins/extract-settings.mjs";

export default defineConfig({
	site: "https://hverlin.github.io/mise-vscode/",
	base: "mise-vscode",
	integrations: [
		starlight({
			title: "mise | VSCode",
			plugins: [
				starlightLinksValidator(),
				starlightImageZoom(),
				extractSettingsDoc(),
			],
			editLink: {
				baseUrl: "https://github.com/hverlin/mise-vscode/tree/main/docs/",
			},
			social: {
				github: "https://github.com/hverlin/mise-vscode",
			},
		}),
	],
});
