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
import {
	extractToolNamesFromLine,
	extractToolVersionFromLine,
	isPositionInToolsContext,
} from "../utils/tomlParsing";

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
	// Collect all decoration ranges per tool key first, then apply once.
	// If we call setDecorations multiple times for the same decoration type,
	// each call replaces the previous — so the same tool on multiple lines
	// (e.g. `pkl` in [tools] AND `tools.pkl` in a task) would lose the first.
	const pendingDecorations = new Map<string, vscode.DecorationOptions[]>();

	for (let line = 0; line < document.lineCount; line++) {
		try {
			const lineText = document.lineAt(line).text;
			const trimmedLine = lineText.trim();

			const { inContext, isInline } = isPositionInToolsContext(
				document,
				new vscode.Position(line, 0),
			);
			if (!inContext) {
				continue;
			}

			if (
				!isInline &&
				trimmedLine.startsWith("[") &&
				trimmedLine !== "[tools]"
			) {
				break;
			}

			if (trimmedLine.startsWith("#") || trimmedLine === "[tools]") {
				continue;
			}

			const toolNamesRaw = extractToolNamesFromLine(lineText);
			if (toolNamesRaw.length === 0) {
				continue;
			}

			const annotations: string[] = [];
			const usedTools: string[] = [];

			for (const raw of toolNamesRaw) {
				const cleanedToolName = getCleanedToolName(raw);
				if (!cleanedToolName) {
					continue;
				}

				const toolFromList =
					tools.find((t) => t.name === cleanedToolName && t.active) ??
					tools.find((t) => t.name === cleanedToolName);

				let resolvedVersion: string | undefined;
				let resolvedInstalled: boolean;

				if (toolFromList) {
					resolvedVersion = toolFromList.version;
					resolvedInstalled = toolFromList.installed;
				} else {
					try {
						const info = await miseService.miseToolInfo(cleanedToolName);
						if (!info) {
							continue;
						}
						const activeVersion = (info.active_versions ?? [])[0];
						const installedVersions = info.installed_versions ?? [];
						resolvedVersion = activeVersion ?? installedVersions[0];
						resolvedInstalled = installedVersions.length > 0;
					} catch {
						continue;
					}
				}

				const reqVersion = extractToolVersionFromLine(lineText, raw);
				if (reqVersion && resolvedVersion) {
					const normalizedReq = reqVersion.replace(/^v/, "");
					if (
						normalizedReq !== "latest" &&
						!resolvedVersion.startsWith(normalizedReq)
					) {
						if (isInline) {
							continue;
						}
						annotations.push("Not installed");
						usedTools.push(cleanedToolName);
						continue;
					}
				}

				if (isInline) {
					if (resolvedInstalled) {
						annotations.push(`${cleanedToolName}: ${resolvedVersion}`);
					}
				} else {
					annotations.push(
						resolvedInstalled ? (resolvedVersion ?? "") : "Not installed",
					);
				}
				usedTools.push(cleanedToolName);
			}

			if (annotations.length === 0) {
				continue;
			}

			const contentText = isInline
				? `\t\t# ${annotations.join(", ")}`
				: `\t\t# ${annotations[0]}`;

			const joinedToolName = usedTools.join("|");
			if (!joinedToolName) continue;

			updatedToolNames.add(joinedToolName);

			const decorationOption: vscode.DecorationOptions = {
				range: new vscode.Range(line, 0, line, lineText.length),
				renderOptions: {
					after: {
						contentText,
						color: "rgba(136,136,136,0.3)",
					},
				},
			};

			const existing = pendingDecorations.get(joinedToolName);
			if (existing) {
				existing.push(decorationOption);
			} else {
				pendingDecorations.set(joinedToolName, [decorationOption]);
			}
		} catch (error) {
			logger.info("Error while showing tool version inline", error);
		}
	}

	const activeTextEditor = vscode.window.activeTextEditor;
	if (!activeTextEditor) {
		return;
	}

	const currentFileInActiveEditor = expandPath(
		activeTextEditor.document.uri.fsPath,
	);
	if (currentFile !== currentFileInActiveEditor) {
		return;
	}

	for (const [joinedToolName, decorationOptions] of pendingDecorations) {
		activeDecorationsPerFileAndTool[currentFile][joinedToolName] ??=
			vscode.window.createTextEditorDecorationType({
				after: { color: "rgba(136,136,136,0.63)" },
			});

		activeTextEditor.setDecorations(
			activeDecorationsPerFileAndTool[currentFile][joinedToolName],
			decorationOptions,
		);
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

	for (let line = 0; line < document.lineCount; line++) {
		try {
			const lineText = document.lineAt(line).text;
			const trimmedLine = lineText.trim();

			const { inContext, isInline } = isPositionInToolsContext(
				document,
				new vscode.Position(line, 0),
			);
			if (!inContext) continue;

			if (
				!isInline &&
				trimmedLine.startsWith("[") &&
				trimmedLine !== "[tools]"
			) {
				break;
			}

			if (trimmedLine.startsWith("#") || trimmedLine === "[tools]") {
				continue;
			}

			const toolNamesRaw = extractToolNamesFromLine(lineText);
			if (toolNamesRaw.length === 0) {
				continue;
			}

			let hasOutdated = false;
			const outdatedNames: string[] = [];
			const validToolNames: string[] = [];

			for (const raw of toolNamesRaw) {
				const cleanedToolName = getCleanedToolName(raw);
				if (!cleanedToolName) {
					continue;
				}

				validToolNames.push(cleanedToolName);

				const outdatedTool = outdatedTools.find(
					(t) => t.name === cleanedToolName,
				);
				if (outdatedTool) {
					hasOutdated = true;
					outdatedNames.push(cleanedToolName);
				}
			}

			if (validToolNames.length === 0) {
				continue;
			}

			const joinedToolName = validToolNames.join("|");
			updatedToolNames.add(joinedToolName);

			if (!hasOutdated) {
				continue;
			}

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

			const firstOutdatedTool = outdatedTools.find(
				(t) => t.name === outdatedNames[0],
			);

			const gutterIconPath = vscode.Uri.parse(
				getSvgIcon(
					vscode.window.activeColorTheme.kind,
					firstOutdatedTool?.version ? "arrow-circle-up" : "warning",
				),
			);

			activeGutterDecorationsPerFileAndTool[currentFile][joinedToolName] ??=
				vscode.window.createTextEditorDecorationType({
					gutterIconPath: gutterIconPath,
					gutterIconSize: "75%",
				});

			const range = new vscode.Range(line, 0, line, 0);
			activeTextEditor.setDecorations(
				activeGutterDecorationsPerFileAndTool[currentFile][joinedToolName],
				[
					{
						range,
						hoverMessage: [
							`Click to install tools: ${outdatedNames.join(", ")}`,
						],
					},
				],
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
