import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import { escapeMarkdown } from "../utils/markdown";
import {
	getCleanedToolName,
	getWebsiteForTool,
	toWebUrl,
} from "../utils/miseUtilts";
import {
	findToolUpdate,
	formatToolOptions,
	getWebsiteLabel,
	markdownLink,
} from "../utils/toolHover";
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

			const markdownString = new vscode.MarkdownString("");
			const toolWebsite = await getWebsiteForTool(toolInfo);
			// the project, when the registry knows it, besides its source
			const projectWebsite = toWebUrl(toolInfo.url ?? undefined);
			const update = findToolUpdate(
				outdatedTools,
				toolName,
				document.uri.fsPath,
			);

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
					[
						"Website",
						projectWebsite && projectWebsite !== toolWebsite
							? markdownLink(getWebsiteLabel(projectWebsite), projectWebsite)
							: undefined,
					],
					["Active version", (toolInfo.active_versions ?? []).join(", ")],
					[
						"Latest version",
						update?.latest
							? update.release_url
								? `${escapeMarkdown(update.latest)} (${markdownLink("release notes", update.release_url)})`
								: escapeMarkdown(update.latest)
							: undefined,
					],
					[
						"Installed Versions",
						(toolInfo.installed_versions ?? []).join(", "),
					],
					["Requested Version", displayRequestedVersion],
					["Options", formatToolOptions(toolInfo.tool_options)],
				]
					.filter(([, val]) => !!val)
					.map(([k, v]) => `${k}: ${v}`)
					.join("\n\n"),
			);

			return new vscode.Hover([markdownString], tool.range);
		},
	});
