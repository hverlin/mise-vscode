import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled, isToolLinksEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { getCachedTomlParser } from "../utils/miseFileParser";
import {
	getCleanedToolName,
	getWebsiteForTool,
	getWebsiteFromToolName,
} from "../utils/miseUtilts";
import { buildToolIndex } from "../utils/toolIndex";

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

			const parser = getCachedTomlParser(document);
			if (!parser) {
				return [];
			}

			const links: vscode.DocumentLink[] = [];
			const linkPromises: Promise<void>[] = [];

			for (const { toolName, range } of buildToolIndex(parser)) {
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
