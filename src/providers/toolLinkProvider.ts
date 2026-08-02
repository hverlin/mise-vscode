import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled, isToolLinksEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import {
	getCleanedToolName,
	getWebsiteForTool,
	getWebsiteFromToolName,
} from "../utils/miseUtilts";
import { getToolIndexForDocument } from "../utils/toolIndex";

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
		// getWebsiteForTool already guarantees an http(s) address
		links.push(new vscode.DocumentLink(range, vscode.Uri.parse(website)));
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

			for (const { toolName, range } of getToolIndexForDocument(document)) {
				const cleanedToolName = getCleanedToolName(toolName);
				if (!cleanedToolName) {
					continue;
				}

				const toolWebsite = getWebsiteFromToolName(cleanedToolName);
				if (toolWebsite) {
					try {
						links.push(
							new vscode.DocumentLink(range, vscode.Uri.parse(toolWebsite)),
						);
					} catch {
						// ignore invalid URI
					}
				} else {
					// Slow path: call miseToolInfo for backends that need tool_options
					linkPromises.push(
						resolveToolLink(miseService, toolName, range, links).catch(
							() => {}, // Ignore errors for individual tools
						),
					);
				}
			}

			await Promise.all(linkPromises);
			return links;
		},
	});
