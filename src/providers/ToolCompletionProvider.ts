import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { getCleanedToolName } from "../utils/miseUtilts";

export class ToolCompletionProvider implements vscode.CompletionItemProvider {
	private miseService: MiseService;

	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	) {
		if (!isMiseExtensionEnabled()) {
			return;
		}

		const [tools, backends] = await Promise.all([
			this.miseService.miseRegistry(),
			this.miseService.miseBackends(),
		]);

		const linePrefix = document
			.lineAt(position)
			.text.substring(0, position.character);

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
			return [];
		}

		if (!linePrefix.includes("=")) {
			const toolsCompletions = tools
				.filter((tool) => tool.short !== undefined)
				.map((tool) => {
					const completionItem = new vscode.CompletionItem(
						{
							label: tool.short as string,
							description: tool.full,
						},
						vscode.CompletionItemKind.Module,
					);
					completionItem.insertText = `${tool.short} = `;
					completionItem.command = {
						command: "editor.action.triggerSuggest",
						title: "Re-trigger completions",
					};
					return completionItem;
				});

			const backendsCompletions = backends.map((backend) => {
				const completionItem = new vscode.CompletionItem(
					{ label: `'${backend}:`, description: `${backend} backend` },
					vscode.CompletionItemKind.Value,
				);
				completionItem.insertText = `'${backend}:`;
				return completionItem;
			});

			return toolsCompletions.concat(backendsCompletions);
		}

		const toolMatch = linePrefix.match(
			/([a-z/'"-0-9:]*)\s*=\s*(["']?)([^"']*)$/,
		);
		if (!toolMatch) {
			return [];
		}

		const [, toolName, existingQuote, partial] = toolMatch;
		if (!toolName) {
			return [];
		}

		const cleanedToolName = getCleanedToolName(toolName);
		const versions = await this.miseService.listRemoteVersions(cleanedToolName);

		return ["latest", ...versions]
			.filter((version) => {
				if (partial) {
					return version.startsWith(partial.replace(/['"]/, ""));
				}
				return true;
			})
			.map((version, i) => {
				const completionItem = new vscode.CompletionItem(
					version,
					vscode.CompletionItemKind.Value,
				);
				completionItem.sortText = i.toString();
				completionItem.insertText = existingQuote ? version : `'${version}'`;
				return completionItem;
			});
	}
}
