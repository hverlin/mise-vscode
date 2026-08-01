import * as vscode from "vscode";
import {
	isMiseExtensionEnabled,
	shouldShowOutdatedToolGutterDecorations,
	shouldShowToolEnvVarsDecorations,
	shouldShowToolVersionsDecorations,
} from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { getSvgIcon } from "../utils/iconUtils";
import { logger } from "../utils/logger";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { getCleanedToolName } from "../utils/miseUtilts";
import { buildToolIndex, type DeclaredTool } from "../utils/toolIndex";

function groupToolsByLine(
	document: vscode.TextDocument,
): Map<number, DeclaredTool[]> {
	const toolsByLine = new Map<number, DeclaredTool[]>();
	const parser = getCachedTomlParser(document);
	if (!parser) {
		return toolsByLine;
	}
	for (const tool of buildToolIndex(parser)) {
		const line = tool.range.start.line;
		const existing = toolsByLine.get(line);
		if (existing) {
			existing.push(tool);
		} else {
			toolsByLine.set(line, [tool]);
		}
	}
	return toolsByLine;
}

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
	const showEnvVars = shouldShowToolEnvVarsDecorations();
	const [files, tools, envsWithInfo] = await Promise.all([
		miseService.getCurrentConfigFiles(),
		miseService.getCurrentTools({ useCache: false }),
		showEnvVars
			? miseService.getEnvWithInfo().catch(() => [])
			: Promise.resolve([]),
	]);

	const envVarsByTool = new Map<string, string[]>();
	for (const env of envsWithInfo) {
		if (env.tool && env.name?.toUpperCase() !== "PATH") {
			const existing = envVarsByTool.get(env.tool);
			if (existing) {
				existing.push(env.name);
			} else {
				envVarsByTool.set(env.tool, [env.name]);
			}
		}
	}
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

	for (const [line, lineTools] of groupToolsByLine(document)) {
		try {
			const lineText = document.lineAt(line).text;
			// task tools (`tools = { ... }`, `tools.<name> = ...`) get the
			// `name: version` annotation style; config tools show the version only
			const isInline = lineTools.some((tool) => tool.inTask);
			const annotations: string[] = [];
			const usedTools: string[] = [];

			for (const declaredTool of lineTools) {
				const cleanedToolName = getCleanedToolName(declaredTool.toolName);
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

				const reqVersion = declaredTool.requestedVersion;
				if (reqVersion && resolvedVersion) {
					// Strip a leading `v` from both sides so git-sourced tools
					// (e.g. `pipx:github/owner/repo` pinned to a tag like
					// `v0.8.7`) are not flagged as "Not installed" when the
					// pin and resolved version match modulo the prefix.
					const normalizedReq = reqVersion.replace(/^v/, "");
					const normalizedResolved = resolvedVersion.replace(/^v/, "");
					if (
						normalizedReq !== "latest" &&
						!normalizedResolved.startsWith(normalizedReq)
					) {
						if (isInline) {
							continue;
						}
						annotations.push("Not installed");
						usedTools.push(cleanedToolName);
						continue;
					}
				}

				const toolEnvVars = envVarsByTool.get(cleanedToolName);
				const envSuffix = toolEnvVars?.length
					? ` → ${toolEnvVars.join(", ")}`
					: "";

				if (isInline) {
					if (resolvedInstalled) {
						annotations.push(
							`${cleanedToolName}: ${resolvedVersion}${envSuffix}`,
						);
					}
				} else {
					annotations.push(
						resolvedInstalled
							? `${resolvedVersion ?? ""}${envSuffix}`
							: "Not installed",
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

	for (const [line, lineTools] of groupToolsByLine(document)) {
		try {
			let hasOutdated = false;
			const outdatedNames: string[] = [];
			const validToolNames: string[] = [];

			for (const declaredTool of lineTools) {
				const cleanedToolName = getCleanedToolName(declaredTool.toolName);
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
