import { readFile } from "node:fs/promises";
import path from "node:path";
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
import { isMiseConfigPath } from "../utils/miseUtilts";

/** Config files change in storms, explain them once they settle */
const REFRESH_DELAY_MS = 500;

export const UNKNOWN_KEY = "unknown-key";
export const DEPRECATED_KEY = "deprecated-key";

/**
 * How Tombi and Even Better TOML name their diagnostics. They check mise
 * config files against the mise schema, associated by the JSON Schema Store
 * catalog they use, the schema `mise config explain` uses too.
 */
const SCHEMA_DIAGNOSTIC_SOURCE = /tombi|even better toml|taplo/i;

/** a mise config file of the disk, open in the editor */
const isOpenMiseConfig = (document: vscode.TextDocument) =>
	document.uri.scheme === "file" && isMiseConfigPath(document.fileName);

/**
 * `mise.toml`, `.mise.toml`, their local variant, a `config.toml` or a
 * `conf.d` fragment: never a task include file, unlike `mise.tasks.toml`
 */
function isBaseConfigName(filePath: string): boolean {
	return (
		/^\.?mise(\.local)?\.toml$|^config(\.local)?\.toml$/.test(
			path.basename(filePath),
		) || path.basename(path.dirname(filePath)) === "conf.d"
	);
}

const rangeOf = (problem: ConfigKeyProblem) =>
	new vscode.Range(problem.line, problem.start, problem.line, problem.end);

function toDiagnostic(problem: ConfigKeyProblem): vscode.Diagnostic {
	const diagnostic = new vscode.Diagnostic(
		rangeOf(problem),
		problem.message,
		problem.kind === "deprecated"
			? vscode.DiagnosticSeverity.Information
			: // mise refuses to load a config with an unknown task key
				/^(tasks|task_templates)\./.test(problem.key)
				? vscode.DiagnosticSeverity.Error
				: vscode.DiagnosticSeverity.Warning,
	);
	diagnostic.source = "mise";
	diagnostic.code = problem.kind === "unknown" ? UNKNOWN_KEY : DEPRECATED_KEY;
	if (problem.kind === "deprecated") {
		diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
	}
	return diagnostic;
}

/**
 * The keys of the mise config files that mise does not read, e.g. a typo, or
 * that are deprecated, from `mise config explain` (mise 2026.10.14+), in the
 * Problems panel. A key Tombi or Even Better TOML already reports only gets
 * the quick fix. Refreshed at the end of every reload, i.e. whenever a config
 * file changes on disk.
 */
export class ConfigKeyDiagnostics implements vscode.Disposable {
	private readonly collection =
		vscode.languages.createDiagnosticCollection("mise-config");
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** a refresh that finishes after a newer one started is dropped */
	private generation = 0;
	/** what mise reported the last time, by file */
	private problems = new Map<string, ConfigKeyProblem[]>();

	/** a config file the listed and standard ones leave out, e.g. in a subfolder */
	private readonly documentListeners = [
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (isOpenMiseConfig(document)) {
				this.scheduleRefresh();
			}
		}),
		// the file watcher does not watch every config file of a subfolder
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (isOpenMiseConfig(document)) {
				this.scheduleRefresh();
			}
		}),
		vscode.workspace.onDidCloseTextDocument((document) => {
			if (isOpenMiseConfig(document)) {
				this.scheduleRefresh();
			}
		}),
	];

	/** a TOML extension starts or stops reporting a key */
	private readonly diagnosticsListener =
		vscode.languages.onDidChangeDiagnostics((event) => {
			for (const uri of event.uris) {
				if (this.problems.has(expandPath(uri.fsPath))) {
					this.publish(uri);
				}
			}
		});

	constructor(private readonly miseService: MiseService) {}

	/** The unknown keys of a file with a key to change them to */
	getSuggestions(filePath: string): ConfigKeyProblem[] {
		return (this.problems.get(expandPath(filePath)) ?? []).filter(
			(problem) =>
				problem.kind === "unknown" && problem.suggestion && problem.name,
		);
	}

	scheduleRefresh() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.refresh().catch((error) => {
				logger.info("Could not explain the config files:", error as Error);
			});
		}, REFRESH_DELAY_MS);
	}

	private clear() {
		this.problems = new Map();
		this.collection.clear();
	}

	async refresh() {
		const generation = ++this.generation;
		// nothing may run against a binary the user has not approved
		if (
			!isMiseExtensionEnabled() ||
			!areConfigDiagnosticsEnabled() ||
			this.miseService.pendingBinaryApproval ||
			!(await this.miseService.supportsConfigExplain())
		) {
			this.clear();
			return;
		}

		// mise refuses to load a config with an unknown task key, and then lists
		// none: the standard config files of the workspace and of its monorepo
		// projects are explained anyway, and the config files open in the
		// editor, e.g. in a subfolder. mise reads them as plain TOML.
		const folders = (vscode.workspace.workspaceFolders ?? []).filter(
			(folder) => folder.uri.scheme === "file",
		);
		const [listed, projectRoots, taskSources] = await Promise.all([
			this.miseService
				.getMiseConfigFiles()
				.then((files) => files.map((file) => expandPath(file.path)))
				.catch(() => [] as string[]),
			this.miseService.getMonorepoConfigRootPaths().catch(() => []),
			this.miseService
				.getAllCachedTasksSources()
				.then((sources) => new Set(sources.map((file) => expandPath(file))))
				.catch(() => new Set<string>()),
		]);
		const standard = (
			await Promise.all(
				[...folders.map((folder) => folder.uri.fsPath), ...projectRoots].map(
					(root) => findStandardConfigFiles(root),
				),
			)
		)
			.flat()
			.map((file) => expandPath(file));
		const open = vscode.workspace.textDocuments
			.filter((document) => isOpenMiseConfig(document))
			.map((document) => expandPath(document.uri.fsPath));

		const listedSet = new Set(listed);
		const configFiles = [
			...new Set([
				...listed,
				// a task include file is not a config: every key of it would read as
				// unknown, e.g. `task_config.includes = ["mise.tasks.toml"]`. The
				// mise.toml of a monorepo project is a task source too.
				...[...standard, ...open].filter(
					(file) =>
						listedSet.has(file) ||
						!taskSources.has(file) ||
						isBaseConfigName(file),
				),
			]),
		].filter((filePath) => filePath.endsWith(".toml"));

		const problemsByFile = new Map<string, ConfigKeyProblem[]>();
		await Promise.all(
			configFiles.map(async (filePath) => {
				try {
					const [explanations, source] = await Promise.all([
						this.miseService.explainConfigFile(filePath),
						readFile(filePath, "utf8"),
					]);
					const problems = findConfigKeyProblems(
						explanations,
						source.split("\n"),
					);
					if (problems.length) {
						problemsByFile.set(filePath, problems);
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
		this.clear();
		this.problems = problemsByFile;
		for (const filePath of problemsByFile.keys()) {
			this.publish(vscode.Uri.file(filePath));
		}
	}

	/**
	 * The problems of a file, but those Tombi or Even Better TOML already
	 * reports on the same key
	 */
	private publish(uri: vscode.Uri) {
		const reported = vscode.languages
			.getDiagnostics(uri)
			.filter((diagnostic) =>
				SCHEMA_DIAGNOSTIC_SOURCE.test(String(diagnostic.source ?? "")),
			);
		const diagnostics = (this.problems.get(expandPath(uri.fsPath)) ?? [])
			.filter(
				(problem) =>
					!reported.some(
						(diagnostic) =>
							diagnostic.range.intersection(rangeOf(problem))?.isEmpty ===
							false,
					),
			)
			.map(toDiagnostic);

		// setting the same diagnostics again fires onDidChangeDiagnostics
		const current = this.collection.get(uri) ?? [];
		if (
			current.length === diagnostics.length &&
			current.every(
				(diagnostic, index) =>
					diagnostic.message === diagnostics[index]?.message &&
					diagnostic.range.isEqual(diagnostics[index].range),
			)
		) {
			return;
		}
		this.collection.set(uri, diagnostics);
	}

	dispose() {
		clearTimeout(this.timer);
		for (const listener of this.documentListeners) {
			listener.dispose();
		}
		this.diagnosticsListener.dispose();
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
