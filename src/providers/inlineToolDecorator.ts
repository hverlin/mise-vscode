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
import { getLazyToolNames } from "../utils/lazyTools";
import { logger } from "../utils/logger";
import { getCleanedToolName, isToolVersionsFile } from "../utils/miseUtilts";
import {
	type DeclaredTool,
	getToolIndexForDocument,
	isConcreteVersion,
} from "../utils/toolIndex";

function groupToolsByLine(
	document: vscode.TextDocument,
): Map<number, DeclaredTool[]> {
	const toolsByLine = new Map<number, DeclaredTool[]>();
	for (const tool of getToolIndexForDocument(document)) {
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

/** The documents that get the tool decorations */
export const isToolsDocument = (document: vscode.TextDocument) =>
	document.languageId === "toml" || isToolVersionsFile(document.fileName);

/**
 * Every editor showing the document gets its decorations, not only the active
 * one. Matched by uri: both sides of a diff have the same path.
 */
function editorsShowing(document: vscode.TextDocument): vscode.TextEditor[] {
	const uri = document.uri.toString();
	return vscode.window.visibleTextEditors.filter(
		(editor) => editor.document.uri.toString() === uri,
	);
}

/** Whether mise loads the document, checked before spawning mise for any TOML */
async function isLoadedConfigFile(
	document: vscode.TextDocument,
	miseService: MiseService,
): Promise<boolean> {
	const files = await miseService.getCurrentConfigFiles();
	return files.includes(expandPath(document.uri.fsPath));
}

// keyed by document uri
const activeDecorationsPerFileAndTool: {
	[documentUri: string]: {
		[toolName: string]: vscode.TextEditorDecorationType;
	};
} = {};

const activeGutterDecorationsPerFileAndTool: {
	[documentUri: string]: {
		[toolName: string]: vscode.TextEditorDecorationType;
	};
} = {};

export async function showToolVersionInline(
	document: vscode.TextDocument,
	miseService: MiseService,
): Promise<void> {
	if (!(await isLoadedConfigFile(document, miseService))) {
		return;
	}

	const showEnvVars = shouldShowToolEnvVarsDecorations();
	const [tools, envsWithInfo] = await Promise.all([
		miseService.getCurrentTools({ useCache: false }),
		showEnvVars
			? miseService.getEnvWithInfo().catch(() => [])
			: Promise.resolve([]),
	]);

	const lazyToolNames = getLazyToolNames(tools);
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
	const documentKey = document.uri.toString();
	activeDecorationsPerFileAndTool[documentKey] ??= {};

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
				// a lazy tool is not installed until one of its commands runs
				const notInstalledLabel = lazyToolNames.has(cleanedToolName)
					? "Installs on first use"
					: "Not installed";

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
				if (reqVersion && resolvedVersion && isConcreteVersion(reqVersion)) {
					// Strip a leading `v` from both sides so git-sourced tools
					// (e.g. `pipx:github/owner/repo` pinned to a tag like
					// `v0.8.7`) are not flagged as "Not installed" when the
					// pin and resolved version match modulo the prefix.
					const normalizedReq = reqVersion.replace(/^v/, "");
					const normalizedResolved = resolvedVersion.replace(/^v/, "");
					if (!normalizedResolved.startsWith(normalizedReq)) {
						if (isInline) {
							continue;
						}
						annotations.push(notInstalledLabel);
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
							: notInstalledLabel,
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

	const editors = editorsShowing(document);
	if (editors.length === 0) {
		return;
	}

	for (const [joinedToolName, decorationOptions] of pendingDecorations) {
		activeDecorationsPerFileAndTool[documentKey][joinedToolName] ??=
			vscode.window.createTextEditorDecorationType({
				after: { color: "rgba(136,136,136,0.63)" },
			});

		for (const editor of editors) {
			editor.setDecorations(
				activeDecorationsPerFileAndTool[documentKey][joinedToolName],
				decorationOptions,
			);
		}
	}

	for (const toolName in activeDecorationsPerFileAndTool[documentKey]) {
		if (!updatedToolNames.has(toolName)) {
			activeDecorationsPerFileAndTool?.[documentKey]?.[toolName]?.dispose();
			delete activeDecorationsPerFileAndTool?.[documentKey]?.[toolName];
		}
	}
}

export async function showOutdatedToolsGutterIcons(
	document: vscode.TextDocument,
	miseService: MiseService,
): Promise<void> {
	if (!(await isLoadedConfigFile(document, miseService))) {
		return;
	}

	const [outdatedTools, tools] = await Promise.all([
		miseService.getOutdatedTools(),
		miseService.getCurrentTools(),
	]);
	// `mise outdated` lists the lazy tools as not installed, like missing ones
	const lazyToolNames = getLazyToolNames(tools);

	const documentKey = document.uri.toString();
	activeGutterDecorationsPerFileAndTool[documentKey] ??= {};

	// one decoration type per tool and icon: a missing tool that becomes
	// outdated (or the reverse) gets the other icon. Ranges are collected first
	// and applied once, as in `showToolVersionInline`
	const pendingDecorations = new Map<
		string,
		{
			iconId: "arrow-circle-up" | "warning";
			options: vscode.DecorationOptions[];
		}
	>();
	const linesWithOutdatedTools: number[] = [];

	for (const [line, lineTools] of groupToolsByLine(document)) {
		try {
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
				if (
					outdatedTool &&
					!(!outdatedTool.version && lazyToolNames.has(cleanedToolName))
				) {
					outdatedNames.push(cleanedToolName);
				}
			}

			if (outdatedNames.length === 0) {
				continue;
			}

			const firstOutdatedTool = outdatedTools.find(
				(t) => t.name === outdatedNames[0],
			);
			const iconId = firstOutdatedTool?.version ? "arrow-circle-up" : "warning";
			const key = `${iconId}:${validToolNames.join("|")}`;

			const decorationOption: vscode.DecorationOptions = {
				range: new vscode.Range(line, 0, line, 0),
				hoverMessage: [`Click to install tools: ${outdatedNames.join(", ")}`],
			};
			const existing = pendingDecorations.get(key);
			if (existing) {
				existing.options.push(decorationOption);
			} else {
				pendingDecorations.set(key, { iconId, options: [decorationOption] });
			}
			linesWithOutdatedTools.push(line + 1);
		} catch (error) {
			logger.info("Error while showing outdated tools gutter icons", error);
		}
	}

	const editors = editorsShowing(document);
	if (editors.length === 0) {
		return;
	}

	for (const [key, { iconId, options }] of pendingDecorations) {
		activeGutterDecorationsPerFileAndTool[documentKey][key] ??=
			vscode.window.createTextEditorDecorationType({
				gutterIconPath: vscode.Uri.parse(
					getSvgIcon(vscode.window.activeColorTheme.kind, iconId),
				),
				gutterIconSize: "75%",
			});

		for (const editor of editors) {
			editor.setDecorations(
				activeGutterDecorationsPerFileAndTool[documentKey][key],
				options,
			);
		}
	}

	// the lines of the line number menu of the active editor
	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor?.document.uri.toString() === documentKey) {
		vscode.commands.executeCommand(
			"setContext",
			"mise.linesWithOutdatedTools",
			linesWithOutdatedTools,
		);
	}

	// disposing a type removes its icons, from the lines no longer outdated too
	for (const key in activeGutterDecorationsPerFileAndTool[documentKey]) {
		if (!pendingDecorations.has(key)) {
			activeGutterDecorationsPerFileAndTool[documentKey][key]?.dispose();
			delete activeGutterDecorationsPerFileAndTool[documentKey][key];
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

	await Promise.all([
		shouldShowOutdatedToolGutterDecorations() &&
			showOutdatedToolsGutterIcons(document, miseService).catch((error) =>
				logger.info("Error while showing outdated tools gutter icons", error),
			),
		shouldShowToolVersionsDecorations() &&
			showToolVersionInline(document, miseService).catch((error) =>
				logger.info("Error while showing tool version inline", error),
			),
	]);
}

/**
 * Redraws the decorations of the visible tool documents. A reload follows
 * everything that changes them without touching the document: installs,
 * uninstalls, upgrades, `mise use`.
 */
export async function refreshToolInfoInVisibleEditors(
	miseService: MiseService,
	context: vscode.ExtensionContext,
): Promise<void> {
	const documents = new Set(
		vscode.window.visibleTextEditors
			.map((editor) => editor.document)
			.filter(isToolsDocument),
	);
	await Promise.all(
		[...documents].map((document) =>
			addToolInfoToEditor(document, miseService, context),
		),
	);
}
