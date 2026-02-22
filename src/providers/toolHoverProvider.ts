import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { getCleanedToolName, getWebsiteForTool } from "../utils/miseUtilts";
import {
	extractToolNamesFromLine,
	extractToolVersionFromLine,
	isPositionInToolsContext,
} from "../utils/tomlParsing";

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

			const { inContext } = isPositionInToolsContext(document, position);
			if (!inContext) {
				return;
			}

			const word = document.getText(wordRange);
			const toolNamesRaw = extractToolNamesFromLine(
				document.lineAt(position).text,
				word,
			);
			if (toolNamesRaw.length === 0) {
				return;
			}
			const toolNameRaw = toolNamesRaw[0];
			if (!toolNameRaw) {
				return;
			}

			const toolName = getCleanedToolName(toolNameRaw);
			if (!toolName) {
				return;
			}

			const toolInfo = await miseService.miseToolInfo(toolNameRaw);
			if (!toolInfo) {
				return;
			}

			const markdownString = new vscode.MarkdownString("");
			const toolWebsite = await getWebsiteForTool(toolInfo);

			const lineText = document.lineAt(position).text;
			const parsedRequestedVersion = extractToolVersionFromLine(
				lineText,
				toolNameRaw,
			);
			const displayRequestedVersion =
				parsedRequestedVersion ||
				(toolInfo.requested_versions ?? []).join(", ");

			markdownString.appendMarkdown(
				[
					[
						"Backend",
						toolWebsite
							? `[${toolInfo.backend}](${toolWebsite})`
							: `${toolInfo.backend}.`,
					],
					["Description", toolInfo.description],
					["Active version", (toolInfo.active_versions ?? []).join(", ")],
					[
						"Installed Versions",
						(toolInfo.installed_versions ?? []).join(", "),
					],
					["Requested Version", displayRequestedVersion],
					[
						"tool_options",
						toolInfo.tool_options &&
						(toolInfo?.tool_options.os ||
							Object.keys(toolInfo.tool_options.install_env || {})?.length >
								1 ||
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
