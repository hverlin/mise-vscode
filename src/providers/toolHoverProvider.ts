import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { getCleanedToolName, getWebsiteForTool } from "../utils/miseUtilts";
import { findToolUpdate, formatToolHover } from "../utils/toolHover";
import { getToolIndexForDocument } from "../utils/toolIndex";

/**
 * How long the hover waits for `mise outdated`, which may query the network,
 * before showing without the latest version
 */
const OUTDATED_TIMEOUT_MS = 1000;

/** The outdated tools, or none when mise takes too long to list them */
async function getOutdatedToolsForHover(
	miseService: MiseService,
): Promise<MiseToolUpdate[]> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			// the result listed for the editor, a hover does not run mise each time
			miseService.getOutdatedTools({ allowStale: true }),
			new Promise<[]>((resolve) => {
				timer = setTimeout(() => resolve([]), OUTDATED_TIMEOUT_MS);
			}),
		]);
	} catch (error) {
		logger.debug("Could not check the tools for updates", error);
		return [];
	} finally {
		clearTimeout(timer);
	}
}

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

			const tool = getToolIndexForDocument(document).find((t) =>
				t.range.contains(position),
			);
			if (!tool) {
				return;
			}

			const toolName = getCleanedToolName(tool.toolName);
			if (!toolName) {
				return;
			}

			const [toolInfo, outdatedTools] = await Promise.all([
				miseService.miseToolInfo(tool.toolName),
				getOutdatedToolsForHover(miseService),
			]);
			if (!toolInfo) {
				return;
			}

			const markdownString = new vscode.MarkdownString(
				formatToolHover({
					toolName,
					toolInfo,
					requestedVersion: tool.requestedVersion,
					backendWebsite: await getWebsiteForTool(toolInfo),
					update: findToolUpdate(outdatedTools, toolName, document.uri.fsPath),
				}),
			);

			return new vscode.Hover([markdownString], tool.range);
		},
	});
