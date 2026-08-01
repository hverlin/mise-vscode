import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { getCleanedToolName, getWebsiteForTool } from "../utils/miseUtilts";
import { buildToolIndex } from "../utils/toolIndex";

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

			const parser = getCachedTomlParser(document);
			if (!parser) {
				return;
			}

			const tool = buildToolIndex(parser).find((t) =>
				t.range.contains(position),
			);
			if (!tool) {
				return;
			}

			const toolName = getCleanedToolName(tool.toolName);
			if (!toolName) {
				return;
			}

			const toolInfo = await miseService.miseToolInfo(tool.toolName);
			if (!toolInfo) {
				return;
			}

			const markdownString = new vscode.MarkdownString("");
			const toolWebsite = await getWebsiteForTool(toolInfo);

			const displayRequestedVersion =
				tool.requestedVersion || (toolInfo.requested_versions ?? []).join(", ");

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

			return new vscode.Hover([markdownString], tool.range);
		},
	});
