import fs from "node:fs";
// https://astro.build/config
import packageJson from "../../../package.json";

const _dirname = new URL(".", import.meta.url).pathname;

export const extractSettingsDoc = () => ({
	name: "extract-settings-doc",
	hooks: {
		setup({ logger }) {
			function generateWikiContent(packageJson) {
				const settings = packageJson.contributes.configuration.properties;
				const settingsEntries = Object.entries(settings).sort(
					([, a], [, b]) => (a.order || 0) - (b.order || 0),
				);

				let content = "";

				for (const [key, setting] of settingsEntries) {
					content += `##### \`${key}\`\n`;

					let typeInfo = `- **Type:** \`${setting.type}\``;
					if (setting.items?.type) {
						typeInfo += ` (array of \`${setting.items.type}\`)`;
					}
					content += `${typeInfo}\n`;

					if (setting.default !== undefined) {
						const defaultValue =
							typeof setting.default === "boolean"
								? setting.default.toString()
								: Array.isArray(setting.default)
									? "[]"
									: JSON.stringify(setting.default);
						content += `- **Default:** \`${defaultValue}\`\n\n`;
					}

					content += `${setting.markdownDescription}\n\n`;

					if (setting.items?.enum) {
						content += "**Available options:**\n\n";
						for (const option of setting.items.enum) {
							content += `- \`${option}\`\n`;
						}
						content += "\n";
					}

					content += "---\n\n";
				}

				return content;
			}

			try {
				const outputPath = `${_dirname}/../generated/Settings.md`;
				const wikiContent = generateWikiContent(packageJson);
				fs.writeFileSync(outputPath, wikiContent);
				logger.info(`Wiki page generated successfully at ${outputPath}`);
			} catch (error) {
				logger.error("Error generating wiki page:", error);
				process.exit(1);
			}
		},
	},
});
