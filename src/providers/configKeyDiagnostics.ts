import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
	areConfigDiagnosticsEnabled,
	isMiseExtensionEnabled,
} from "../configuration";
import { findStandardConfigFiles } from "../miseFileWatcher";
import type { MiseService } from "../miseService";
import {
	type ConfigKeyProblem,
	findConfigKeyProblems,
} from "../utils/configExplain";
import { expandPath } from "../utils/fileUtils";
import { logger } from "../utils/logger";

/** Config files change in storms, explain them once they settle */
const REFRESH_DELAY_MS = 500;

export const UNKNOWN_KEY = "unknown-key";
export const DEPRECATED_KEY = "deprecated-key";

/**
 * Extensions that check mise config files against the mise schema (see
 * `tomlValidation` in package.json). mise explains keys with the same schema,
 * so they already report the unknown keys.
 */
const SCHEMA_EXTENSIONS = ["tombi-toml.tombi", "tamasfe.even-better-toml"];

const hasSchemaExtension = () =>
	SCHEMA_EXTENSIONS.some((id) => vscode.extensions.getExtension(id));

/**
 * The keys of the mise config files that mise does not read, e.g. a typo, or
 * that are deprecated, from `mise config explain` (mise 2026.10.14+), in the
 * Problems panel. With a TOML extension that already reports unknown keys,
 * only their quick fix is added. Refreshed at the end of every reload, i.e.
 * whenever a config file changes on disk.
 */
export class ConfigKeyDiagnostics implements vscode.Disposable {
	private readonly collection =
		vscode.languages.createDiagnosticCollection("mise-config");
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** a refresh that finishes after a newer one started is dropped */
	private generation = 0;
	/** the unknown keys mise suggests another key for, by file */
	private suggestions = new Map<string, ConfigKeyProblem[]>();

	/** a TOML extension installed or removed changes who reports unknown keys */
	private readonly extensionsListener = vscode.extensions.onDidChange(() =>
		this.scheduleRefresh(),
	);

	constructor(private readonly miseService: MiseService) {}

	/** The unknown keys of a file with a key to change them to */
	getSuggestions(filePath: string): ConfigKeyProblem[] {
		return this.suggestions.get(expandPath(filePath)) ?? [];
	}

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
			this.suggestions.clear();
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

		const reportsUnknownKeys = !hasSchemaExtension();
		const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();
		const suggestionsByFile = new Map<string, ConfigKeyProblem[]>();
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
					const problems = findConfigKeyProblems(
						explanations,
						source.split("\n"),
					);
					suggestionsByFile.set(
						filePath,
						problems.filter(
							(problem) =>
								problem.kind === "unknown" &&
								problem.suggestion &&
								problem.name,
						),
					);
					const diagnostics = problems
						.filter(
							(problem) => problem.kind === "deprecated" || reportsUnknownKeys,
						)
						.map((problem) => {
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
		this.suggestions = suggestionsByFile;
		this.collection.clear();
		for (const [filePath, diagnostics] of diagnosticsByFile) {
			this.collection.set(vscode.Uri.file(filePath), diagnostics);
		}
	}

	dispose() {
		clearTimeout(this.timer);
		this.extensionsListener.dispose();
		this.collection.dispose();
	}
}

/**
 * Replaces an unknown key with the one mise suggests, on the diagnostic of
 * this extension or of the TOML extension that reports it
 */
export class ConfigKeyQuickFixProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

	constructor(private readonly diagnostics: ConfigKeyDiagnostics) {}

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		return this.diagnostics
			.getSuggestions(document.uri.fsPath)
			.flatMap((problem) => {
				const keyRange = new vscode.Range(
					problem.line,
					problem.start,
					problem.line,
					problem.end,
				);
				// the file may have changed since mise read it
				if (
					!problem.suggestion ||
					!keyRange.intersection(range) ||
					document.getText(keyRange) !== problem.name
				) {
					return [];
				}

				const action = new vscode.CodeAction(
					`Change to \`${problem.suggestion}\``,
					vscode.CodeActionKind.QuickFix,
				);
				action.edit = new vscode.WorkspaceEdit();
				action.edit.replace(document.uri, keyRange, problem.suggestion);
				action.diagnostics = context.diagnostics.filter((diagnostic) =>
					diagnostic.range.intersection(keyRange),
				);
				action.isPreferred = true;
				return [action];
			});
	}
}
