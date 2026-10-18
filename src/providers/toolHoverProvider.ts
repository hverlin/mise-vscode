import type { DocumentSelector } from "vscode";
import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { logger } from "../utils/logger";
import {
	getCleanedToolName,
	getWebsiteForTool,
	toWebUrl,
} from "../utils/miseUtilts";
import { getToolIndexForDocument } from "../utils/toolIndex";

/**
 * How long the hover waits for `mise outdated`, which may query the network,
 * before showing without the latest version
 */
const OUTDATED_TIMEOUT_MS = 1000;

/** The available update of a tool, or undefined when it takes too long */
async function findToolUpdate(
	miseService: MiseService,
	toolName: string,
): Promise<MiseToolUpdate | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const outdatedTools = await Promise.race([
			miseService.getOutdatedTools(),
			new Promise<[]>((resolve) => {
				timer = setTimeout(() => resolve([]), OUTDATED_TIMEOUT_MS);
			}),
		]);
		return outdatedTools.find((t) => t.name === toolName);
	} catch (error) {
		logger.debug("Could not check the tool for updates", error);
		return undefined;
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

			const [toolInfo, update] = await Promise.all([
				miseService.miseToolInfo(tool.toolName),
				findToolUpdate(miseService, toolName),
			]);
			if (!toolInfo) {
				return;
			}

			const markdownString = new vscode.MarkdownString("");
			const toolWebsite = await getWebsiteForTool(toolInfo);
			// the project, when the registry knows it, besides its source
			const projectWebsite = toWebUrl(toolInfo.url ?? undefined);
			const projectWebsiteLabel = projectWebsite
				?.replace(/^https?:\/\//, "")
				.replace(/\/$/, "");

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
							? `[${projectWebsiteLabel}](${projectWebsite})`
							: undefined,
					],
					["Active version", (toolInfo.active_versions ?? []).join(", ")],
					[
						"Latest version",
						update?.latest
							? update.release_url
								? `${update.latest} ([release notes](${update.release_url}))`
								: update.latest
							: undefined,
					],
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
