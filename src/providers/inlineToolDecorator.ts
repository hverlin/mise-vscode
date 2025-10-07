import * as vscode from "vscode";
import {
	isMiseExtensionEnabled,
	shouldShowOutdatedToolGutterDecorations,
	shouldShowToolVersionsDecorations,
} from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { getSvgIcon } from "../utils/iconUtils";
import { logger } from "../utils/logger";
import { getCleanedToolName } from "../utils/miseUtilts";

const activeDecorationsPerFileAndTool: {
	[filePath: string]: {
		[toolName: string]: vscode.TextEditorDecorationType;
	};
} = {};

const activeGutterDecorationsPerFileAndTool: {
	[filePath: string]: {
		[toolName: string]: vscode.TextEditorDecorationType;
	};
} = {};

export async function showToolVersionInline(
	document: vscode.TextDocument,
	miseService: MiseService,
): Promise<void> {
	const [files, tools] = await Promise.all([
		miseService.getCurrentConfigFiles(),
		miseService.getCurrentTools({ useCache: false }),
	]);
	const currentFile = expandPath(document.uri.fsPath);
	if (!files.includes(currentFile)) {
		return;
	}

	activeDecorationsPerFileAndTool[currentFile] ??= {};
	activeGutterDecorationsPerFileAndTool[currentFile] ??= {};

	const updatedToolNames = new Set<string>();

	let inToolsSection = false;
	for (let line = 0; line < document.lineCount; line++) {
		try {
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

			const toolMatch = trimmedLine.match(/^([a-zA-z/'"\-0-9:]*)\s*=\s.*/);
			if (!toolMatch || !toolMatch[1]) {
				continue;
			}

			const cleanedToolName = getCleanedToolName(toolMatch[1]);
			if (!cleanedToolName) {
				continue;
			}

			const toolInfo = tools.find((t) => t.name === cleanedToolName);

			updatedToolNames.add(cleanedToolName);
			activeDecorationsPerFileAndTool[currentFile][cleanedToolName] ??=
				vscode.window.createTextEditorDecorationType({
					after: { color: "rgba(136,136,136,0.63)" },
				});

			const activeTextEditor = vscode.window.activeTextEditor;
			if (!activeTextEditor) {
				return;
			}

			const currentFileInActiveEditor = expandPath(
				activeTextEditor?.document.uri.fsPath,
			);
			if (currentFile !== currentFileInActiveEditor) {
				return;
			}

			vscode.window.activeTextEditor?.setDecorations(
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
		} catch (error) {
			logger.info("Error while showing tool version inline", error);
		}
	}

	for (const toolName in activeDecorationsPerFileAndTool[currentFile]) {
		if (!updatedToolNames.has(toolName)) {
			activeDecorationsPerFileAndTool?.[currentFile]?.[toolName]?.dispose();
			delete activeDecorationsPerFileAndTool?.[currentFile]?.[toolName];
		}
	}
}

export async function showOutdatedToolsGutterIcons(
	document: vscode.TextDocument,
	miseService: MiseService,
): Promise<void> {
	const [files, outdatedTools] = await Promise.all([
		miseService.getCurrentConfigFiles(),
		miseService.getOutdatedTools(),
	]);

	const currentFile = expandPath(document.uri.fsPath);
	if (!files.includes(currentFile)) {
		return;
	}

	activeDecorationsPerFileAndTool[currentFile] ??= {};
	activeGutterDecorationsPerFileAndTool[currentFile] ??= {};

	const updatedToolNames = new Set<string>();
	const linesWithOutdatedTools: number[] = [];

	let inToolsSection = false;
	for (let line = 0; line < document.lineCount; line++) {
		try {
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

			const outdatedTool = outdatedTools.find(
				(t) => t.name === cleanedToolName,
			);
			if (!outdatedTool) {
				continue;
			}

			updatedToolNames.add(cleanedToolName);

			const activeTextEditor = vscode.window.activeTextEditor;
			if (!activeTextEditor) {
				return;
			}

			const currentFileInActiveEditor = expandPath(
				activeTextEditor?.document.uri.fsPath,
			);
			if (currentFile !== currentFileInActiveEditor) {
				return;
			}

			const gutterIconPath = vscode.Uri.parse(
				getSvgIcon(
					vscode.window.activeColorTheme.kind,
					outdatedTool.version ? "arrow-circle-up" : "warning",
				),
			);
			activeGutterDecorationsPerFileAndTool[currentFile][cleanedToolName] ??=
				vscode.window.createTextEditorDecorationType({
					gutterIconPath: gutterIconPath,
					gutterIconSize: "75%",
				});

			const range = new vscode.Range(line, 0, line, 0);
			activeTextEditor.setDecorations(
				activeGutterDecorationsPerFileAndTool[currentFile][cleanedToolName],
				[{ range, hoverMessage: ["Click to install tool"] }],
			);
			linesWithOutdatedTools.push(line + 1);
		} catch (error) {
			logger.info("Error while showing outdated tools gutter icons", error);
		}
	}

	vscode.commands.executeCommand(
		"setContext",
		"mise.linesWithOutdatedTools",
		linesWithOutdatedTools,
	);

	for (const toolName in activeGutterDecorationsPerFileAndTool[currentFile]) {
		if (!updatedToolNames.has(toolName)) {
			activeGutterDecorationsPerFileAndTool?.[currentFile]?.[
				toolName
			]?.dispose();
			delete activeGutterDecorationsPerFileAndTool?.[currentFile]?.[toolName];
		}
	}
}

export async function addToolInfoToEditor(
	document: vscode.TextDocument,
	miseService: MiseService,
	_context: vscode.ExtensionContext,
): Promise<void> {
	if (!isMiseExtensionEnabled()) {
		return;
	}

	if (shouldShowOutdatedToolGutterDecorations()) {
		showOutdatedToolsGutterIcons(document, miseService).catch((error) =>
			logger.info("Error while showing outdated tools gutter icons", error),
		);
	}

	if (shouldShowToolVersionsDecorations()) {
		showToolVersionInline(document, miseService).catch((error) =>
			logger.info("Error while showing tool version inline", error),
		);
	}
}
