import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled, isToolLinksEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	getCleanedToolName,
	getWebsiteForTool,
	getWebsiteFromToolName,
} from "../utils/miseUtilts";
import {
	extractToolNamesFromLine,
	isPositionInToolsContext,
} from "../utils/tomlParsing";

async function resolveToolLink(
	miseService: MiseService,
	toolName: string,
	range: vscode.Range,
	links: vscode.DocumentLink[],
): Promise<void> {
	const toolInfo = await miseService.miseToolInfo(toolName);
	if (!toolInfo) {
		return;
	}

	const website = await getWebsiteForTool(toolInfo);
	if (!website) {
		return;
	}

	try {
		const parsedUri = website.startsWith("http")
			? vscode.Uri.parse(website)
			: vscode.Uri.parse(
					`https://${website.replace(/^git\+/, "").replace(/^git:\/\//, "")}`,
				);
		links.push(new vscode.DocumentLink(range, parsedUri));
	} catch {
		// Ignore invalid URIs
	}
}

export const createToolLinkProvider = (
	documentSelector: DocumentSelector,
	miseService: MiseService,
) =>
	vscode.languages.registerDocumentLinkProvider(documentSelector, {
		async provideDocumentLinks(document: vscode.TextDocument) {
			if (!isMiseExtensionEnabled() || !isToolLinksEnabled()) {
				return [];
			}

			const links: vscode.DocumentLink[] = [];
			const linkPromises: Promise<void>[] = [];

			for (let i = 0; i < document.lineCount; i++) {
				const line = document.lineAt(i);
				const text = line.text.trim();

				const { inContext } = isPositionInToolsContext(
					document,
					new vscode.Position(i, 0),
				);
				if (!inContext || text.length === 0 || text.startsWith("#")) {
					continue;
				}

				const toolNames = extractToolNamesFromLine(line.text);

				for (const toolName of toolNames) {
					if (!toolName) continue;

					const cleanedToolName = getCleanedToolName(toolName);
					if (!cleanedToolName) continue;

					const quotedDouble = `"${toolName}"`;
					const quotedSingle = `'${toolName}'`;
					let startIndex: number;
					let endIndex: number;
					if (line.text.includes(quotedDouble)) {
						startIndex = line.text.indexOf(quotedDouble);
						endIndex = startIndex + quotedDouble.length;
					} else if (line.text.includes(quotedSingle)) {
						startIndex = line.text.indexOf(quotedSingle);
						endIndex = startIndex + quotedSingle.length;
					} else {
						startIndex = line.text.indexOf(toolName);
						endIndex = startIndex + toolName.length;
					}

					if (startIndex === -1) {
						continue;
					}

					const toolWebsite = getWebsiteFromToolName(cleanedToolName);
					if (toolWebsite) {
						try {
							const range = new vscode.Range(
								new vscode.Position(i, startIndex),
								new vscode.Position(i, endIndex),
							);
							links.push(
								new vscode.DocumentLink(range, vscode.Uri.parse(toolWebsite)),
							);
						} catch {
							// ignore invalid URI
						}
					} else {
						// Slow path: call miseToolInfo for backends that need tool_options
						const range = new vscode.Range(
							new vscode.Position(i, startIndex),
							new vscode.Position(i, endIndex),
						);
						linkPromises.push(
							resolveToolLink(miseService, toolName, range, links).catch(
								() => {}, // Ignore errors for individual tools
							),
						);
					}
				}
			}

			await Promise.all(linkPromises);
			return links;
		},
	});
