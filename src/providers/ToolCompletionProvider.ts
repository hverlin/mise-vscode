import * as vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { getCleanedToolName, isToolVersionsFile } from "../utils/miseUtilts";
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

		if (isToolVersionsFile(document.fileName)) {
			// Backend-prefixed first token (`core:`, `npm:pretti`, ...):
			// complete registry tools of that backend with their full name
			const backendPrefixMatch = linePrefix.match(
				/^\s*([a-zA-Z0-9_-]+:)(\S*)$/,
			);
			if (backendPrefixMatch) {
				const [, backendPrefix = "", partial = ""] = backendPrefixMatch;
				const typedToken = backendPrefix + partial;
				return tools
					.filter((tool) => tool.full?.startsWith(backendPrefix))
					.map((tool) => {
						const completionItem = new vscode.CompletionItem(
							{ label: tool.full as string, description: tool.short },
							vscode.CompletionItemKind.Module,
						);
						completionItem.insertText = `${tool.full} `;
						completionItem.filterText = tool.full;
						// `:` is not a word character, so replace the whole token
						// explicitly instead of relying on the word range
						completionItem.range = new vscode.Range(
							position.translate(0, -typedToken.length),
							position,
						);
						completionItem.command = {
							command: "editor.action.triggerSuggest",
							title: "Re-trigger completions",
						};
						return completionItem;
					});
			}

			// First token: tool name completions (`nodejs `, `shellcheck `, ...)
			if (linePrefix.match(/^\s*\S*$/)) {
				const toolsCompletions = tools
					.filter((tool) => tool.short !== undefined)
					.map((tool) => {
						const completionItem = new vscode.CompletionItem(
							{ label: tool.short as string, description: tool.full },
							vscode.CompletionItemKind.Module,
						);
						completionItem.insertText = `${tool.short} `;
						completionItem.command = {
							command: "editor.action.triggerSuggest",
							title: "Re-trigger completions",
						};
						return completionItem;
					});

				const backendsCompletions = backends.map((backend) => {
					const completionItem = new vscode.CompletionItem(
						{ label: `${backend}:`, description: `${backend} backend` },
						vscode.CompletionItemKind.Value,
					);
					completionItem.insertText = `${backend}:`;
					completionItem.command = {
						command: "editor.action.triggerSuggest",
						title: "Re-trigger completions",
					};
					return completionItem;
				});

				return toolsCompletions.concat(backendsCompletions);
			}

			// After the tool name: version completions for the current token
			const versionMatch = linePrefix.match(/^\s*(\S+)\s+(?:\S+\s+)*(\S*)$/);
			if (!versionMatch?.[1] || linePrefix.includes("#")) {
				return [];
			}
			return this.getVersionCompletions(
				getCleanedToolName(versionMatch[1]),
				versionMatch[2],
				position,
				{ wrapInQuotes: false },
			);
		}

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
				partial,
				position,
				{ wrapInQuotes: !existingQuote },
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
				inlineVersion.partial,
				position,
				{ wrapInQuotes: !inlineVersion.quote },
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
			partial,
			position,
			{ wrapInQuotes: !existingQuote },
		);
	}

	private async getVersionCompletions(
		cleanedToolName: string,
		partial: string | undefined,
		position: vscode.Position,
		{ wrapInQuotes }: { wrapInQuotes: boolean },
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
				completionItem.insertText = wrapInQuotes ? `'${version}'` : version;
				completionItem.range = replaceRange;
				return completionItem;
			});
	}
}
