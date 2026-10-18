import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
	areConfigDiagnosticsEnabled,
	isMiseExtensionEnabled,
} from "../configuration";
import { findStandardConfigFiles } from "../miseFileWatcher";
import type { MiseService } from "../miseService";
import { findConfigKeyProblems } from "../utils/configExplain";
import { expandPath } from "../utils/fileUtils";
import { logger } from "../utils/logger";

/** Config files change in storms, explain them once they settle */
const REFRESH_DELAY_MS = 500;

export const UNKNOWN_KEY = "unknown-key";
export const DEPRECATED_KEY = "deprecated-key";

/** `Did you mean `experimental`?` at the end of an unknown key diagnostic */
const SUGGESTION = /Did you mean `([^`]+)`\?$/;

/**
 * The keys of the mise config files that mise does not read, e.g. a typo, or
 * that are deprecated, from `mise config explain` (mise 2026.10.14+), in the
 * Problems panel. Refreshed at the end of every reload, i.e. whenever a
 * config file changes on disk.
 */
export class ConfigKeyDiagnostics implements vscode.Disposable {
	private readonly collection =
		vscode.languages.createDiagnosticCollection("mise-config");
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** a refresh that finishes after a newer one started is dropped */
	private generation = 0;

	constructor(private readonly miseService: MiseService) {}

	scheduleRefresh() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.refresh().catch((error) => {
				logger.info("Could not explain the config files:", error as Error);
			});
		}, REFRESH_DELAY_MS);
	}

	async refresh() {
		const generation = ++this.generation;
		// nothing may run against a binary the user has not approved
		if (
			!isMiseExtensionEnabled() ||
			!areConfigDiagnosticsEnabled() ||
			this.miseService.pendingBinaryApproval
		) {
			this.collection.clear();
			return;
		}

		// the config files only: a task include file is not one, and every key
		// of it would read as unknown. mise refuses to load a config with an
		// unknown task key, and then lists none: the standard config files of
		// the workspace are explained anyway, mise reads them as plain TOML.
		const folders = (vscode.workspace.workspaceFolders ?? []).filter(
			(folder) => folder.uri.scheme === "file",
		);
		const [listed, standard] = await Promise.all([
			this.miseService
				.getMiseConfigFiles()
				.then((files) => files.map((file) => file.path))
				.catch(() => [] as string[]),
			Promise.all(
				folders.map((folder) => findStandardConfigFiles(folder.uri.fsPath)),
			).then((files) => files.flat()),
		]);
		const configFiles = [
			...new Set([...listed, ...standard].map((file) => expandPath(file))),
		].filter((filePath) => filePath.endsWith(".toml"));

		const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();
		await Promise.all(
			configFiles.map(async (filePath) => {
				try {
					const [explanations, source] = await Promise.all([
						this.miseService.explainConfigFile(filePath),
						readFile(filePath, "utf8"),
					]);
					if (!explanations) {
						return;
					}
					const diagnostics = findConfigKeyProblems(
						explanations,
						source.split("\n"),
					).map((problem) => {
						const diagnostic = new vscode.Diagnostic(
							new vscode.Range(
								problem.line,
								problem.start,
								problem.line,
								problem.end,
							),
							problem.message,
							problem.kind === "unknown"
								? vscode.DiagnosticSeverity.Warning
								: vscode.DiagnosticSeverity.Information,
						);
						diagnostic.source = "mise";
						diagnostic.code =
							problem.kind === "unknown" ? UNKNOWN_KEY : DEPRECATED_KEY;
						if (problem.kind === "deprecated") {
							diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
						}
						return diagnostic;
					});
					if (diagnostics.length) {
						diagnosticsByFile.set(filePath, diagnostics);
					}
				} catch (error) {
					// e.g. a file that does not parse, reported elsewhere
					logger.debug(`Could not explain ${filePath}:`, error as Error);
				}
			}),
		);

		if (generation !== this.generation) {
			return;
		}
		this.collection.clear();
		for (const [filePath, diagnostics] of diagnosticsByFile) {
			this.collection.set(vscode.Uri.file(filePath), diagnostics);
		}
	}

	dispose() {
		clearTimeout(this.timer);
		this.collection.dispose();
	}
}

/** Replaces an unknown key with the one mise suggests */
export class ConfigKeyQuickFixProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		return context.diagnostics.flatMap((diagnostic) => {
			const suggestion = diagnostic.message.match(SUGGESTION)?.[1];
			// the key name, not the whole line it falls back on
			const name = document.getText(diagnostic.range);
			if (
				diagnostic.source !== "mise" ||
				diagnostic.code !== UNKNOWN_KEY ||
				!suggestion ||
				!/^[\w-]+$/.test(name)
			) {
				return [];
			}

			const action = new vscode.CodeAction(
				`Change to \`${suggestion}\``,
				vscode.CodeActionKind.QuickFix,
			);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(document.uri, diagnostic.range, suggestion);
			action.diagnostics = [diagnostic];
			action.isPreferred = true;
			return [action];
		});
	}
}
