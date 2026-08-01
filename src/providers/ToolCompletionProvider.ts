import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { getCleanedToolName } from "../utils/miseUtilts";
import {
	parseInlineTableVersionPrefix,
	parseToolsSectionHeader,
	splitDottedToolKey,
} from "../utils/tomlParsing";

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

		// Complete tool names while typing a `[tools.<name>]` section header
		const headerPrefixMatch = linePrefix.match(
			/^\s*\[\s*tools\s*\.\s*(["']?)[^\]]*$/,
		);
		if (headerPrefixMatch) {
			const [, existingQuote] = headerPrefixMatch;
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
					completionItem.insertText = tool.short;
					return completionItem;
				});

			const backendsCompletions = backends.map((backend) => {
				const completionItem = new vscode.CompletionItem(
					{ label: `${backend}:`, description: `${backend} backend` },
					vscode.CompletionItemKind.Value,
				);
				// Backend-prefixed names contain `:` and must be quoted in a header
				completionItem.insertText = existingQuote
					? `${backend}:`
					: `"${backend}:`;
				return completionItem;
			});

			return toolsCompletions.concat(backendsCompletions);
		}

		let inToolsSection = false;
		let sectionToolName: string | undefined;
		for (let i = position.line; i >= 0; i--) {
			const line = document.lineAt(i).text.trim();
			if (line === "[tools]") {
				inToolsSection = true;
				break;
			}
			if (line.startsWith("[")) {
				// `[tools.node]` section: only offer version completions for
				// the `version` option of that tool
				const header = parseToolsSectionHeader(line);
				if (header && !header.isSubTable && i !== position.line) {
					sectionToolName = header.toolName;
				}
				break;
			}
		}

		if (sectionToolName) {
			const versionValueMatch = linePrefix.match(
				/^\s*version\s*=\s*\[?\s*(["']?)([^"']*)$/,
			);
			if (!versionValueMatch) {
				return [];
			}
			const [, existingQuote, partial] = versionValueMatch;
			return this.getVersionCompletions(
				getCleanedToolName(sectionToolName),
				existingQuote,
				partial,
				position,
			);
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

		// `node = { version = "2` — complete the version inside an inline options table
		const inlineVersion = parseInlineTableVersionPrefix(linePrefix);
		if (inlineVersion) {
			return this.getVersionCompletions(
				getCleanedToolName(inlineVersion.toolName),
				inlineVersion.quote,
				inlineVersion.partial,
				position,
			);
		}
		if (linePrefix.includes("{")) {
			// Inside an inline table but typing another option (os, postinstall, ...)
			return [];
		}

		const toolMatch = linePrefix.match(
			/([a-zA-Z/'"\-0-9:.]*)\s*=\s*(["']?)([^"']*)$/,
		);
		if (!toolMatch) {
			return [];
		}

		const [, toolKey, existingQuote, partial] = toolMatch;
		if (!toolKey) {
			return [];
		}

		// Support dotted keys like `node.version = ` or `"npm:prettier".version = `
		const { toolName, optionPath } = splitDottedToolKey(toolKey);
		if (!toolName || (optionPath && optionPath !== "version")) {
			return [];
		}

		return this.getVersionCompletions(
			getCleanedToolName(toolName),
			existingQuote,
			partial,
			position,
		);
	}

	private async getVersionCompletions(
		cleanedToolName: string,
		existingQuote: string | undefined,
		partial: string | undefined,
		position: vscode.Position,
	) {
		const versions = await this.miseService.listRemoteVersions(cleanedToolName);

		// Replace the partial version already typed (e.g. `23.` in `'23.`),
		// otherwise accepting `23.11.1` would insert after it → `23.23.11.1`
		const replaceRange = partial?.length
			? new vscode.Range(position.translate(0, -partial.length), position)
			: undefined;

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
				completionItem.range = replaceRange;
				return completionItem;
			});
	}
}
