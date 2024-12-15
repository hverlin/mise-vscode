import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";

const _dirname = new URL(".", import.meta.url).pathname;

const pageContent = `---
title: Extension Settings
description: VSCode mise extension settings
sidebar:
    order: 305
tableOfContents:
  minHeadingLevel: 1
  maxHeadingLevel: 5
---

You can configure the extension behavior through Visual Studio Code settings. To
access the settings:

1. Open the Command Palette (\`Ctrl+Shift+P\` / \`Cmd+Shift+P\`)
2. Type "Settings: Open Settings (UI)"
3. Search for "Mise"

You can also click on the mise extension indicator in the status bar to quickly
access the extension settings.

![picture showing mise extension settings](..//../../assets/mise-menu.png)

## Settings`;

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
	const outputPath = path.join(
		_dirname,
		"content",
		"docs",
		"reference",
		"Settings.md",
	);
	const wikiContent = generateWikiContent(packageJson);
	fs.writeFileSync(outputPath, `${pageContent}\n\n${wikiContent}`);
	console.log(`Wiki page generated successfully at ${outputPath}`);
} catch (error) {
	console.error("Error generating wiki page:", error);
	process.exit(1);
}
