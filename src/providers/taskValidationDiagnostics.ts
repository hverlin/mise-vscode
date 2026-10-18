import * as vscode from "vscode";
import {
	areTaskDiagnosticsEnabled,
	isMiseExtensionEnabled,
} from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { logger } from "../utils/logger";
import {
	findTaskDefinition,
	getCachedTomlParser,
} from "../utils/miseFileParser";
import { getTaskDefinitionNameCandidates } from "../utils/taskNames";
import {
	filterTaskValidationIssues,
	findFileTaskIssueLine,
	findTomlTaskIssueRange,
	findValidatedTask,
	formatTaskIssueMessage,
	getTaskIssueTarget,
} from "../utils/taskValidation";

const SEVERITIES: Record<
	MiseTaskValidationIssue["severity"],
	vscode.DiagnosticSeverity
> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

/** Config files and task scripts change in storms, validate once they settle */
const REFRESH_DELAY_MS = 500;

/** The whole text of a line, without its indentation */
function lineRange(document: vscode.TextDocument, line: number) {
	const textLine = document.lineAt(line);
	return new vscode.Range(
		line,
		textLine.firstNonWhitespaceCharacterIndex,
		line,
		textLine.text.length,
	);
}

/**
 * Problems of the task definitions reported by `mise tasks validate` in the
 * Problems panel: dependency cycles, missing dependencies, usage specs that do
 * not parse, unknown daemons, ... Refreshed at the end of every reload, i.e.
 * whenever a config file or a task changes on disk, once the configs are
 * trusted.
 */
export class TaskValidationDiagnostics implements vscode.Disposable {
	private readonly collection =
		vscode.languages.createDiagnosticCollection("mise-tasks");
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** a refresh that finishes after a newer one started is dropped */
	private generation = 0;

	constructor(private readonly miseService: MiseService) {}

	scheduleRefresh() {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.refresh().catch((error) => {
				logger.info("Could not validate the tasks:", error as Error);
			});
		}, REFRESH_DELAY_MS);
	}

	async refresh() {
		const generation = ++this.generation;
		// nothing may run against a binary the user has not approved
		if (
			!isMiseExtensionEnabled() ||
			!areTaskDiagnosticsEnabled() ||
			this.miseService.pendingBinaryApproval
		) {
			this.collection.clear();
			return;
		}

		const [validation, tasks] = await Promise.all([
			this.miseService.getTasksValidation(),
			this.miseService.getAllCachedTasks().catch(() => []),
		]);

		const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();
		for (const issue of filterTaskValidationIssues(validation?.issues ?? [])) {
			const task = findValidatedTask(tasks, issue.task);
			if (!task?.source) {
				continue;
			}

			const filePath = expandPath(task.source);
			const range = await this.findIssueRange(filePath, task.name, issue);
			if (!range) {
				continue;
			}

			const diagnostic = new vscode.Diagnostic(
				range,
				formatTaskIssueMessage(issue),
				SEVERITIES[issue.severity] ?? vscode.DiagnosticSeverity.Error,
			);
			diagnostic.source = "mise";
			diagnostic.code = issue.category;
			diagnosticsByFile.set(filePath, [
				...(diagnosticsByFile.get(filePath) ?? []),
				diagnostic,
			]);
		}

		if (generation !== this.generation) {
			return;
		}
		this.collection.clear();
		for (const [filePath, diagnostics] of diagnosticsByFile) {
			this.collection.set(vscode.Uri.file(filePath), diagnostics);
		}
	}

	/** Where the issue goes in the file declaring the task */
	private async findIssueRange(
		filePath: string,
		taskName: string,
		issue: MiseTaskValidationIssue,
	): Promise<vscode.Range | undefined> {
		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(
				vscode.Uri.file(filePath),
			);
		} catch {
			// e.g. a remote task file that is not cached
			return undefined;
		}

		const target = getTaskIssueTarget(issue);
		if (document.fileName.endsWith(".toml")) {
			const parser = getCachedTomlParser(document);
			const tasksTable = parser?.parsed as { tasks?: unknown } | undefined;
			// task include files declare their tasks at the top level
			const taskKeys = getTaskDefinitionNameCandidates(taskName).map((name) =>
				tasksTable?.tasks ? ["tasks", name] : [name],
			);
			const range = parser
				? findTomlTaskIssueRange(
						parser.getAllPositions(),
						document.getText().split("\n"),
						taskKeys,
						target,
					)
				: undefined;
			if (range) {
				return new vscode.Range(
					range.start.line,
					range.start.character,
					range.end.line,
					range.end.character,
				);
			}
		}

		if (
			document.fileName.endsWith(".toml") ||
			document.fileName.endsWith("package.json")
		) {
			return lineRange(
				document,
				findTaskDefinition(document, taskName).start.line,
			);
		}

		return lineRange(
			document,
			findFileTaskIssueLine(document.getText().split("\n"), target),
		);
	}

	dispose() {
		clearTimeout(this.timer);
		this.collection.dispose();
	}
}
