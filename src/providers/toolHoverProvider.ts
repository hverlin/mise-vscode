import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { getWebsiteForTool } from "../utils/miseUtilts";

export const createToolHoverProvider = (
	documentSelector: DocumentSelector,
	miseService: MiseService,
) =>
	vscode.languages.registerHoverProvider(documentSelector, {
		async provideHover(
			document: vscode.TextDocument,
			position: vscode.Position,
		) {
			if (!isMiseExtensionEnabled()) {
				return;
			}

			const wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				return;
			}

			let inToolsSection = false;
			for (let i = position.line; i >= 0; i--) {
				const line = document.lineAt(i).text.trim();
				if (line === "[tools]") {
					inToolsSection = true;
					break;
				}
				if (line.startsWith("[") && line !== "[tools]") {
					break;
				}
			}

			if (!inToolsSection) {
				return;
			}

			const toolMatch = document
				.lineAt(position)
				.text.match(/['"]?([0-9A-Za-z./:\-]*)['"]?\s*=\s*.*/);

			if (!toolMatch) {
				return;
			}

			const [, toolName] = toolMatch;
			if (!toolName) {
				return;
			}

			const word = document.getText(wordRange);
			if (!toolName.includes(word)) {
				return;
			}

			const toolInfo = await miseService.miseToolInfo(toolName);
			if (!toolInfo) {
				return;
			}

			const markdownString = new vscode.MarkdownString("");
			const toolWebsite = await getWebsiteForTool(toolInfo);

			markdownString.appendMarkdown(
				[
					[
						"Backend",
						toolWebsite
							? `[${toolInfo.backend}](${toolWebsite})`
							: `${toolInfo.backend}.`,
					],
					["Description", toolInfo.description],
					["Active version", toolInfo.active_versions.join(", ")],
					["Installed Versions", toolInfo.installed_versions.join(", ")],
					["Requested Version", toolInfo.requested_versions.join(", ")],
					[
						"tool_options",
						toolInfo.tool_options &&
						(toolInfo?.tool_options.os ||
							Object.keys(toolInfo.tool_options.install_env)?.length > 1 ||
							Object.keys(toolInfo.tool_options).length >= 3)
							? JSON.stringify(toolInfo.tool_options)
							: undefined,
					],
				]
					.filter(([, val]) => !!val)
					.map(([k, v]) => `${k}: ${v}`)
					.join("\n\n"),
			);

			return new vscode.Hover([markdownString]);
		},
	});
