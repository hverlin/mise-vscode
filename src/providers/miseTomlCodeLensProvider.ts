import * as vscode from "vscode";
import {
	MISE_INSTALL_ALL,
	MISE_LIST_ALL_TOOLS,
	MISE_RUN_TASK,
	MISE_SHOW_BOOTSTRAP,
	MISE_SHOW_SETTINGS,
	MISE_SHOW_TASK_CACHE_MENU,
	MISE_USE_TOOL,
	MISE_WATCH_TASK,
} from "../commands";
import {
	isBootstrapCodeLensEnabled,
	isCodeLensEnabled,
	isMiseExtensionEnabled,
} from "../configuration";
import type { MiseService } from "../miseService";
import { groupBootstrapEntriesByDeclaringTable } from "../utils/bootstrapDocument";
import {
	BOOTSTRAP_OK_STATES,
	type BootstrapEntry,
	getBootstrapSections,
	isBootstrapEntryPending,
} from "../utils/bootstrapUtils";
import { expandPath } from "../utils/fileUtils";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { isMiseTomlFile } from "../utils/miseUtilts";
import {
	findCacheEnabledTasks,
	formatBytes,
	formatCacheSummary,
	totalCacheSize,
} from "../utils/taskCache";
import { getLocalTaskName, qualifyTaskName } from "../utils/taskNames";

function createRunTaskCodeLens(
	taskName: string,
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(play) Run",
		tooltip: `Run task ${taskName}`,
		command: MISE_RUN_TASK,
		arguments: [taskName],
	});
}

function createWatchTaskCodeLens(
	taskName: string,
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(eye-watch) Watch",
		tooltip: `Watch task ${taskName}`,
		command: MISE_WATCH_TASK,
		arguments: [taskName],
	});
}

function createRunAndWatchTaskCodeLens(
	taskName: string,
	range: vscode.Range,
): vscode.CodeLens[] {
	return [
		createRunTaskCodeLens(taskName, range),
		createWatchTaskCodeLens(taskName, range),
	];
}

function createAddToolCodeLens(
	range: vscode.Range,
	filePath: string,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(add) Add tool",
		tooltip: "Add tool",
		command: MISE_USE_TOOL,
		arguments: [filePath],
	});
}

function addListToolsCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(list-unordered) List tools",
		tooltip: "List tools",
		command: MISE_LIST_ALL_TOOLS,
		arguments: [],
	});
}

function addSettingsListCodeLens(range: vscode.Range): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(gear) Manage settings",
		tooltip: "Manage settings",
		command: MISE_SHOW_SETTINGS,
		arguments: [],
	});
}

function createTaskCacheCodeLens(
	taskName: string,
	entries: MiseTaskCacheEntry[],
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: entries.length
			? `$(database) Cache · ${formatBytes(totalCacheSize(entries))}`
			: "$(database) Cache",
		tooltip: `Task output cache of ${taskName} (${formatCacheSummary(entries)})`,
		command: MISE_SHOW_TASK_CACHE_MENU,
		arguments: [taskName],
	});
}

/** entries listed in a lens tooltip before it is summarised */
const MAX_LISTED = 10;

/** `[bootstrap.packages]` reads as `bootstrap.packages`, `[dotfiles]` as `dotfiles` */
function tableLabel(tablePath: string[]): string {
	return tablePath.join(".");
}

function createBootstrapCodeLens(
	tablePath: string[],
	entries: BootstrapEntry[],
	range: vscode.Range,
): vscode.CodeLens {
	const pending = entries.filter(isBootstrapEntryPending);
	const label = tableLabel(tablePath);

	// entries mise could not inspect here (a Linux section on macOS, docker
	// down) are not actionable: reporting them as pending would be a false
	// alarm, and reporting them as ok would claim a state nobody checked
	const converged = entries.filter((entry) =>
		BOOTSTRAP_OK_STATES.has(entry.state),
	);
	// `1/2 pending` reads the same way as the bootstrap tree view sections
	let title: string;
	if (pending.length) {
		title = `$(warning) Bootstrap · ${pending.length}/${entries.length} pending`;
	} else if (converged.length) {
		title = `$(check) Bootstrap · ${converged.length} ok`;
	} else {
		title = "$(circle-slash) Bootstrap · not applicable here";
	}

	const listed = (pending.length ? pending : entries).slice(0, MAX_LISTED);
	const detail = listed
		.map((entry) => `${entry.label} (${entry.state})`)
		.join("\n");
	const remaining = (pending.length || entries.length) - listed.length;

	return new vscode.CodeLens(range, {
		title,
		tooltip: `[${label}] (${entries.length} ${
			entries.length === 1 ? "entry" : "entries"
		})\n${detail}${remaining > 0 ? `\n+${remaining} more` : ""}`,
		command: MISE_SHOW_BOOTSTRAP,
		arguments: [label],
	});
}

function createInstallMissingToolsCodeLens(
	range: vscode.Range,
): vscode.CodeLens {
	return new vscode.CodeLens(range, {
		title: "$(cloud-download) Install missing tools",
		tooltip: "Install missing tools",
		command: MISE_INSTALL_ALL,
	});
}

export class MiseTomlCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> =
		new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> =
		this._onDidChangeCodeLenses.event;

	constructor(private miseService: MiseService) {
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (!isMiseExtensionEnabled()) {
				return;
			}

			if (!isCodeLensEnabled()) {
				return;
			}

			if (e.document.fileName.endsWith(".toml")) {
				this._onDidChangeCodeLenses.fire();
			}
		});

		// the task cache lens reports state that changes without the document
		// being touched, e.g. when a cached task runs in a terminal
		const refresh = () => {
			if (isMiseExtensionEnabled() && isCodeLensEnabled()) {
				this._onDidChangeCodeLenses.fire();
			}
		};
		miseService.subscribeToTaskCacheEvent(refresh);
		miseService.subscribeToReloadEvent(refresh);
	}

	private handleInTasksSection(i: number, lineContent: string) {
		const trimmedLine = lineContent.trim();
		const inlineName = trimmedLine.split("=")[0]?.trim();
		if (
			inlineName &&
			!inlineName.includes(".") &&
			!inlineName.startsWith("[")
		) {
			const taskName = inlineName.replace(/^["']|["']$/g, "");

			const startPos = new vscode.Position(i, lineContent.indexOf(taskName));
			const endPos = startPos.translate(0, taskName.length);
			return createRunAndWatchTaskCodeLens(
				taskName,
				new vscode.Range(startPos, endPos),
			);
		}

		return [];
	}

	private handleTaskFile(document: vscode.TextDocument): vscode.CodeLens[] {
		// we are already in a [tasks] section so valid patterns are
		// abc = '333' or "lint:test" = '333'
		// [abc] or ["lint:ci"]
		// run = '333'
		const codeLenses: vscode.CodeLens[] = [];
		const lines = document.getText().split("\n");

		let inTasksSection = true;
		for (let i = 0; i < lines.length; i++) {
			const lineContent = lines[i];
			if (!lineContent) {
				continue;
			}
			const trimmedLine = lineContent.trim();
			if (!trimmedLine) continue;

			if (/\[.*]/.test(trimmedLine)) {
				inTasksSection = false;
			}

			if (inTasksSection) {
				codeLenses.push(...this.handleInTasksSection(i, lineContent));
			} else {
				const match = trimmedLine.match(/^\s*\[["']?(.*)["']?]/);

				if (match) {
					const taskName = match[1] || match[2] || match[3];

					if (taskName) {
						const taskPosition = lineContent.indexOf(taskName);
						const startPos = new vscode.Position(i, taskPosition);
						const endPos = startPos.translate(0, taskName.length);
						codeLenses.push(
							...createRunAndWatchTaskCodeLens(
								taskName,
								new vscode.Range(startPos, endPos),
							),
						);
					}
				}
			}
		}
		return codeLenses;
	}

	private async handleMiseTomlFile(document: vscode.TextDocument) {
		const codeLenses: vscode.CodeLens[] = [];
		const lines = document.getText().split("\n");

		let inTasksSection = false;

		for (let i = 0; i < lines.length; i++) {
			const lineContent = lines[i];
			if (!lineContent) {
				continue;
			}
			const trimmedLine = lineContent.trim();
			if (!trimmedLine) continue;

			if (trimmedLine.trim().startsWith("[settings]")) {
				const range = new vscode.Range(
					new vscode.Position(i, 0),
					new vscode.Position(i, 0),
				);
				codeLenses.push(addSettingsListCodeLens(range));
			}

			if (trimmedLine.trim().startsWith("[tools]")) {
				const range = new vscode.Range(
					new vscode.Position(i, 0),
					new vscode.Position(i, 0),
				);
				codeLenses.push(createAddToolCodeLens(range, document.uri.path));
				codeLenses.push(addListToolsCodeLens(range));
				if (await this.miseService.hasMissingTools()) {
					codeLenses.push(createInstallMissingToolsCodeLens(range));
				}
			}

			// Check if we're entering [tasks] section
			if (trimmedLine === "[tasks]") {
				inTasksSection = true;
				continue;
			}

			// Check if we're leaving [tasks] section (entering a new section)
			if (trimmedLine.startsWith("[") && trimmedLine !== "[tasks]") {
				inTasksSection = false;
			}

			const match = trimmedLine.match(
				/^\s*\[tasks\.(?:["']([^"']+)["']|([^\]]+))\]/,
			);
			// tasks.aaa = '3'
			const match2 = trimmedLine.match(
				/^\s*tasks\.["']?(.*)["']?\s*=\s*['"]?(.*)['"]?/,
			);

			if (match || match2) {
				const taskName = match
					? match[1] || match[2] || match[3]
					: match2
						? match2[1]
						: null;

				if (taskName) {
					const taskPosition = lineContent.indexOf(taskName);
					const startPos = new vscode.Position(i, taskPosition);
					const endPos = startPos.translate(0, taskName.length);
					codeLenses.push(
						...createRunAndWatchTaskCodeLens(
							taskName,
							new vscode.Range(startPos, endPos),
						),
					);
				}
			} else if (inTasksSection) {
				codeLenses.push(...this.handleInTasksSection(i, lineContent));
			}
		}

		return codeLenses;
	}

	/**
	 * Monorepo tasks must be run with their qualified name, not the local name
	 * found in the document
	 */
	private async qualifyTaskNamesInLenses(
		document: vscode.TextDocument,
		codeLenses: vscode.CodeLens[],
	): Promise<vscode.CodeLens[]> {
		const tasks = await this.miseService.getAllCachedTasks();
		const documentPath = expandPath(document.uri.fsPath);

		for (const codeLens of codeLenses) {
			const { command } = codeLens;
			if (
				command?.arguments?.length !== 1 ||
				(command.command !== MISE_RUN_TASK &&
					command.command !== MISE_WATCH_TASK)
			) {
				continue;
			}

			const localName = command.arguments[0];
			if (typeof localName !== "string") {
				continue;
			}

			command.arguments = [qualifyTaskName(tasks, localName, documentPath)];
		}

		return codeLenses;
	}

	/**
	 * A cache lens next to the run lens of every task that opts into the
	 * experimental output cache. Nothing is fetched for documents without one,
	 * so the common case costs a single TOML parse (already cached).
	 */
	private async addTaskCacheLenses(
		document: vscode.TextDocument,
		codeLenses: vscode.CodeLens[],
	): Promise<vscode.CodeLens[]> {
		const parsed = getCachedTomlParser(document)?.parsed;
		if (!parsed) {
			return codeLenses;
		}

		const cacheEnabledTasks = findCacheEnabledTasks(parsed);
		if (cacheEnabledTasks.size === 0) {
			return codeLenses;
		}

		// a cached task can run without the extension noticing (from a terminal,
		// or outside of the editor), so the entries have to be watched
		this.miseService.ensureTaskCacheWatcher();

		const cacheInfo = await this.miseService.getTaskCacheInfo();
		const withCacheLenses: vscode.CodeLens[] = [];
		for (const codeLens of codeLenses) {
			withCacheLenses.push(codeLens);

			const { command } = codeLens;
			// task names are already qualified at this point
			const taskName = command?.arguments?.[0];
			if (command?.command !== MISE_RUN_TASK || typeof taskName !== "string") {
				continue;
			}
			if (!cacheEnabledTasks.has(getLocalTaskName(taskName))) {
				continue;
			}

			const entries =
				cacheInfo.find((info) => info.task === taskName)?.entries ?? [];
			withCacheLenses.push(
				createTaskCacheCodeLens(taskName, entries, codeLens.range),
			);
		}

		return withCacheLenses;
	}

	/**
	 * One lens per `[bootstrap.*]` table declared in this document, reporting
	 * how many of its entries are not in their desired state. Documents without
	 * a bootstrap section never read the status, which is what keeps this cheap:
	 * `mise bootstrap status` inspects the machine.
	 */
	private async addBootstrapLenses(
		document: vscode.TextDocument,
		codeLenses: vscode.CodeLens[],
	): Promise<vscode.CodeLens[]> {
		if (!isBootstrapCodeLensEnabled()) {
			return codeLenses;
		}

		const parsed = getCachedTomlParser(document)?.parsed as
			| { bootstrap?: unknown; dotfiles?: unknown }
			| undefined;
		if (!parsed?.bootstrap && !parsed?.dotfiles) {
			return codeLenses;
		}

		const status = await this.miseService.getBootstrapStatus();
		if (!status) {
			return codeLenses;
		}

		// the status merges every config file, and an entry is not always written
		// in the table it is reported under, so the grouping is resolved against
		// this document rather than taken from the status
		const entries = getBootstrapSections(status).flatMap(
			(section) => section.entries,
		);

		return [
			...codeLenses,
			...groupBootstrapEntriesByDeclaringTable(document, entries).map(
				(section) =>
					createBootstrapCodeLens(
						section.tablePath,
						section.entries,
						section.range,
					),
			),
		];
	}

	public async provideCodeLenses(
		document: vscode.TextDocument,
	): Promise<vscode.CodeLens[]> {
		if (!isMiseExtensionEnabled()) {
			return [];
		}

		if (!isCodeLensEnabled()) {
			return [];
		}

		if (!document.fileName.endsWith(".toml")) {
			return [];
		}

		const files = await this.miseService.getCurrentConfigFiles();
		if (!files.includes(expandPath(document.uri.fsPath))) {
			return [];
		}

		const codeLenses = isMiseTomlFile(document.fileName)
			? await this.handleMiseTomlFile(document)
			: this.handleTaskFile(document);

		return this.addBootstrapLenses(
			document,
			await this.addTaskCacheLenses(
				document,
				await this.qualifyTaskNamesInLenses(document, codeLenses),
			),
		);
	}
}
