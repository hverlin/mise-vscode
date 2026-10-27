import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "toml-v1";
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
import {
	expandConfigRoots,
	getMonorepoConfigRoots,
	getTaskIncludes,
	isTaskInclude,
} from "../utils/configFilesToExplain";
import { expandPath } from "../utils/fileUtils";
import { SCHEMA_DIAGNOSTIC_SOURCE } from "../utils/languageServer";
import { logger } from "../utils/logger";
import { isMiseConfigPath } from "../utils/miseUtilts";
import { getConfigRootPaths } from "../utils/taskNames";

/** Config files change in storms, explain them once they settle */
const REFRESH_DELAY_MS = 500;

export const UNKNOWN_KEY = "unknown-key";
export const DEPRECATED_KEY = "deprecated-key";

/** a mise config file of the disk */
const isMiseConfigUri = (uri: vscode.Uri) =>
	uri.scheme === "file" && isMiseConfigPath(uri.fsPath);

const tabUri = (tab: vscode.Tab) =>
	tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined;

/**
 * The mise config files open in an editor tab. `workspace.textDocuments` has
 * the documents extensions read too, this one included.
 */
function openConfigFiles(): string[] {
	return vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.flatMap((tab) => {
			const uri = tabUri(tab);
			return uri && isMiseConfigUri(uri) ? [expandPath(uri.fsPath)] : [];
		});
}

/** A config file parsed, undefined when it cannot be read or parsed */
async function readConfig(filePath: string): Promise<unknown> {
	try {
		return parse(await readFile(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

async function listDirectories(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => [],
	);
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

/** The directories a file is in, its own first, up to a workspace folder */
function configRootsAbove(filePath: string): string[] {
	const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
	const top = folder ? expandPath(folder.uri.fsPath) : undefined;
	const roots: string[] = [];
	let directory = path.dirname(filePath);
	// a file outside the workspace: its own directory and a few above
	for (let depth = 0; depth < (top ? 64 : 4); depth++) {
		roots.push(directory);
		const parent = path.dirname(directory);
		if (directory === top || parent === directory) {
			break;
		}
		directory = parent;
	}
	return roots;
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
 * file changes on disk, and for one file when it is opened in an editor tab,
 * saved or closed.
 */
export class ConfigKeyDiagnostics implements vscode.Disposable {
	private readonly collection =
		vscode.languages.createDiagnosticCollection("mise-config");
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** a refresh that finishes after a newer one started is dropped */
	private generation = 0;
	/** what mise reported the last time, by file */
	private problems = new Map<string, ConfigKeyProblem[]>();
	/** the config files mise lists, as of the last refresh */
	private listed = new Set<string>();
	/** the config files explained open or not, as of the last refresh */
	private baseFiles = new Set<string>();
	/** whether mise explains config files, as of the last refresh */
	private supported = false;

	/** a config file the listed and standard ones leave out, e.g. in a subfolder */
	private readonly editorListeners = [
		vscode.window.tabGroups.onDidChangeTabs((event) => {
			for (const tab of event.opened) {
				const uri = tabUri(tab);
				if (uri && isMiseConfigUri(uri)) {
					void this.refreshFile(expandPath(uri.fsPath));
				}
			}
			for (const tab of event.closed) {
				const uri = tabUri(tab);
				if (uri && isMiseConfigUri(uri)) {
					this.dropClosedFile(expandPath(uri.fsPath));
				}
			}
		}),
		// the file watcher does not watch every config file of a subfolder
		vscode.workspace.onDidSaveTextDocument((document) => {
			const filePath = expandPath(document.uri.fsPath);
			if (
				isMiseConfigUri(document.uri) &&
				(this.baseFiles.has(filePath) || openConfigFiles().includes(filePath))
			) {
				void this.refreshFile(filePath);
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

	/**
	 * @param servedByLanguageServer whether `mise lsp` reports the problems of
	 * the config files instead
	 */
	constructor(
		private readonly miseService: MiseService,
		private readonly servedByLanguageServer: () => boolean = () => false,
	) {}

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
		this.baseFiles = new Set();
		this.collection.clear();
	}

	// nothing may run against a binary the user has not approved
	private isActive() {
		return (
			isMiseExtensionEnabled() &&
			areConfigDiagnosticsEnabled() &&
			!this.servedByLanguageServer() &&
			!this.miseService.pendingBinaryApproval
		);
	}

	async refresh() {
		const generation = ++this.generation;
		this.supported =
			this.isActive() && (await this.miseService.supportsConfigExplain());
		if (!this.supported) {
			this.clear();
			return;
		}

		// mise refuses to load a config with an unknown task key, and then lists
		// none: the standard config files of the workspace and of its monorepo
		// projects are explained anyway, and the config files open in an editor
		// tab, e.g. in a subfolder. mise reads them as plain TOML.
		const folders = (vscode.workspace.workspaceFolders ?? [])
			.filter((folder) => folder.uri.scheme === "file")
			.map((folder) => folder.uri.fsPath);
		const [listed, projectRoots] = await Promise.all([
			this.miseService
				.getMiseConfigFiles()
				.then((files) => files.map((file) => expandPath(file.path)))
				.catch(() => [] as string[]),
			this.findMonorepoProjects(folders),
		]);
		const standard = (
			await Promise.all(
				[...folders, ...projectRoots].map((root) =>
					findStandardConfigFiles(root),
				),
			)
		)
			.flat()
			.map((file) => expandPath(file));
		const open = openConfigFiles();

		const listedSet = new Set(listed);
		const others = [...new Set([...standard, ...open])].filter(
			(file) => !listedSet.has(file),
		);
		const includes = await this.findTaskIncludes(others);
		const configFiles = [
			...listed,
			...others.filter((file) => !includes.has(file)),
		].filter((filePath) => filePath.endsWith(".toml"));

		const problemsByFile = new Map<string, ConfigKeyProblem[]>();
		await Promise.all(
			configFiles.map(async (filePath) => {
				// a config being typed does not parse: what it had is kept
				const problems =
					(await this.explain(filePath)) ?? this.problems.get(filePath);
				if (problems?.length) {
					problemsByFile.set(filePath, problems);
				}
			}),
		);

		if (generation !== this.generation) {
			return;
		}
		this.clear();
		this.listed = listedSet;
		const standardSet = new Set(standard);
		this.baseFiles = new Set(
			configFiles.filter(
				(file) => listedSet.has(file) || standardSet.has(file),
			),
		);
		this.problems = problemsByFile;
		for (const filePath of problemsByFile.keys()) {
			this.publish(vscode.Uri.file(filePath));
		}
	}

	/** The problems of a config file, undefined when mise cannot read it */
	private async explain(
		filePath: string,
	): Promise<ConfigKeyProblem[] | undefined> {
		try {
			const [explanations, source] = await Promise.all([
				this.miseService.explainConfigFile(filePath),
				readFile(filePath, "utf8"),
			]);
			return findConfigKeyProblems(explanations, source.split("\n"));
		} catch (error) {
			// e.g. a file that does not parse, reported elsewhere
			logger.debug(`Could not explain ${filePath}:`, error as Error);
			return undefined;
		}
	}

	/** One config file, opened in a tab or saved */
	private async refreshFile(filePath: string) {
		if (
			!this.supported ||
			!this.isActive() ||
			!filePath.endsWith(".toml") ||
			(!this.listed.has(filePath) &&
				(await this.findTaskIncludes([filePath])).has(filePath))
		) {
			return;
		}

		const problems = await this.explain(filePath);
		// a config being typed does not parse: what it had is kept
		if (problems === undefined) {
			return;
		}
		if (problems.length) {
			this.problems.set(filePath, problems);
		} else {
			this.problems.delete(filePath);
		}
		this.publish(vscode.Uri.file(filePath));
	}

	/** A file explained only while open, its last tab closed */
	private dropClosedFile(filePath: string) {
		if (this.baseFiles.has(filePath) || openConfigFiles().includes(filePath)) {
			return;
		}
		this.problems.delete(filePath);
		this.collection.delete(vscode.Uri.file(filePath));
	}

	/**
	 * The roots of the monorepo projects: from the tasks mise lists, and from
	 * `[monorepo] config_roots`, for a project whose config mise refuses, and
	 * so lists no task of, or that has no task
	 */
	private async findMonorepoProjects(folders: string[]): Promise<string[]> {
		const workspaceRoot = this.miseService.getCurrentWorkspaceFolderPath();
		const [tasks, declared] = await Promise.all([
			this.miseService.getAllCachedTasks().catch(() => []),
			Promise.all(
				folders.map(async (folder) => {
					const configs = await findStandardConfigFiles(folder);
					const patterns = (await Promise.all(configs.map(readConfig))).flatMap(
						getMonorepoConfigRoots,
					);
					return expandConfigRoots(folder, patterns, listDirectories);
				}),
			),
		]);
		const fromTasks = workspaceRoot
			? getConfigRootPaths(tasks).map((configRoot) =>
					path.join(workspaceRoot, configRoot),
				)
			: [];
		return [
			...new Set(
				[...fromTasks, ...declared.flat()].map((root) => expandPath(root)),
			),
		];
	}

	/**
	 * The task files out of these files, the ones a config root above them
	 * includes with `[task_config] includes`: they are not configs, and every
	 * key of them would read as unknown
	 */
	private async findTaskIncludes(files: string[]): Promise<Set<string>> {
		const includesByRoot = new Map<string, Promise<string[]>>();
		const includesOf = (root: string) => {
			let includes = includesByRoot.get(root);
			if (!includes) {
				includes = findStandardConfigFiles(root).then(async (configs) =>
					(await Promise.all(configs.map(readConfig))).flatMap(getTaskIncludes),
				);
				includesByRoot.set(root, includes);
			}
			return includes;
		};

		const included = await Promise.all(
			files.map(async (file) => {
				for (const root of configRootsAbove(file)) {
					if (isTaskInclude(file, root, await includesOf(root))) {
						return true;
					}
				}
				return false;
			}),
		);
		return new Set(files.filter((_file, index) => included[index]));
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
		for (const listener of this.editorListeners) {
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
