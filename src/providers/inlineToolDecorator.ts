import * as vscode from "vscode";
import {
	isMiseExtensionEnabled,
	shouldShowToolVersionsDecorations,
} from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { getCleanedToolName } from "../utils/miseUtilts";

const activeDecorationsPerFileAndTool: {
	[filePath: string]: {
		[toolName: string]: vscode.TextEditorDecorationType;
	};
} = {};

export async function showToolVersionInline(
	document: vscode.TextDocument,
	miseService: MiseService,
): Promise<void> {
	if (!isMiseExtensionEnabled()) {
		return;
	}

	if (!shouldShowToolVersionsDecorations()) {
		return;
	}

	const currentFile = expandPath(document.uri.fsPath);

	const [files, tools] = await Promise.all([
		miseService.getCurrentConfigFiles(),
		miseService.getCurrentTools({ useCache: false }),
	]);
	if (!files.includes(currentFile)) {
		return;
	}

	activeDecorationsPerFileAndTool[currentFile] ??= {};
	const updatedToolNames = new Set<string>();

	let inToolsSection = false;
	for (let line = 0; line < document.lineCount; line++) {
		const lineText = document.lineAt(line).text;
		const trimmedLine = lineText.trim();
		if (trimmedLine === "[tools]") {
			inToolsSection = true;
			continue;
		}

		if (!inToolsSection) {
			continue;
		}

		if (trimmedLine.startsWith("[")) {
			break;
		}

		if (trimmedLine.startsWith("#")) {
			continue;
		}

		const toolMatch = trimmedLine.match(/^([a-z/'"-0-9:]*)\s*=\s.*/);
		if (!toolMatch || !toolMatch[1]) {
			continue;
		}

		const cleanedToolName = getCleanedToolName(toolMatch[1]);
		if (!cleanedToolName) {
			continue;
		}

		const toolInfo = tools.find((t) => t.name === cleanedToolName);

		updatedToolNames.add(cleanedToolName);
		// @ts-ignore
		activeDecorationsPerFileAndTool[currentFile][cleanedToolName] ??=
			vscode.window.createTextEditorDecorationType({
				after: {
					color: "rgba(136,136,136,0.63)",
				},
			});

		vscode.window.activeTextEditor?.setDecorations(
			// @ts-ignore
			activeDecorationsPerFileAndTool[currentFile][cleanedToolName],
			[
				{
					range: new vscode.Range(line, 0, line, lineText.length),
					renderOptions: {
						after: {
							contentText: toolInfo?.installed
								? `\t\t# ${toolInfo?.version ?? ""}`
								: "\t\t# Not installed",
							color: "rgba(136,136,136,0.3)",
						},
					},
				},
			],
		);
	}

	for (const toolName in activeDecorationsPerFileAndTool[currentFile]) {
		if (!updatedToolNames.has(toolName)) {
			activeDecorationsPerFileAndTool?.[currentFile]?.[toolName]?.dispose();
			delete activeDecorationsPerFileAndTool?.[currentFile]?.[toolName];
		}
	}
}
