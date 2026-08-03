import vscode from "vscode";
import { isMiseExtensionEnabled } from "../configuration";
import type { MiseService } from "../miseService";
import { expandPath } from "../utils/fileUtils";
import { getCachedTomlParser } from "../utils/miseFileParser";
import { isDependsKeyword, isMiseTomlFile } from "../utils/miseUtilts";
import {
	findTaskCacheDeclarations,
	formatBytes,
	formatCacheSummary,
	formatDuration,
	formatLastAccessed,
} from "../utils/taskCache";
import {
	findTasksMatchingDependsPattern,
	getTaskDefinitionNameCandidates,
	resolveTaskReference,
	TASK_NAME_REGEX,
	TASK_PATTERN_REGEX,
} from "../utils/taskNames";

/**
 * What the hover knows about the output cache of a task: its stored entries,
 * and the key of its next run when that could be computed without side effects.
 */
type TaskCacheState = {
	entries: MiseTaskCacheEntry[];
	nextRunKey?: string;
};

function createMarkdownString(
	task: MiseTask,
	cacheState: TaskCacheState = { entries: [] },
): vscode.MarkdownString {
	const markdownString = new vscode.MarkdownString();
	markdownString.supportHtml = true;
	markdownString.appendMarkdown(`**${task.name}**`);
	if (task.description) {
		markdownString.appendMarkdown(`<br />${task.description}`);
	}
	if (task.run) {
		markdownString.appendCodeblock(task.run?.join("\n") || "", "shell");
	}
	if (task.file) {
		markdownString.appendMarkdown(`\n\nFile: ${task.file}`);
	}
	appendCacheSection(markdownString, cacheState);
	return markdownString;
}

/** Task output cache state, only shown for tasks that have cached results */
function appendCacheSection(
	markdownString: vscode.MarkdownString,
	{ entries, nextRunKey }: TaskCacheState,
) {
	if (entries.length === 0) {
		return;
	}

	const lines = [`Cache: ${formatCacheSummary(entries)}`];

	const hit = nextRunKey
		? entries.find((entry) => entry.key === nextRunKey)
		: undefined;
	if (hit) {
		lines.push(
			`Next run: cache hit · restores ${formatBytes(hit.restored_bytes)} · saves ${formatDuration(hit.execution_duration_ns)}`,
		);
	} else if (nextRunKey) {
		lines.push("Next run: cache miss · the task will execute");
	}

	// `current` marks the entry of the last key mise recorded for the task, not
	// one recomputed from the inputs as they are now: it cannot be reported as
	// a cache hit the next run would get
	const latest = entries.find((entry) => entry.current);
	if (latest && !nextRunKey) {
		lines.push(
			`Latest entry: \`${latest.key.slice(0, 12)}\` · restores ${formatBytes(latest.restored_bytes)} · stored from a ${formatDuration(latest.execution_duration_ns)} run`,
		);
	}

	const lastAccessed = Math.max(...entries.map((entry) => entry.last_accessed));
	lines.push(`Last used: ${formatLastAccessed(lastAccessed)}`);

	markdownString.appendMarkdown(`\n\n---\n\n${lines.join("<br />")}`);
}

function createTaskListMarkdownString(
	pattern: string,
	tasks: MiseTask[],
): vscode.MarkdownString {
	const markdownString = new vscode.MarkdownString();
	markdownString.appendMarkdown(
		`**${pattern}** matches ${tasks.length} tasks:\n\n`,
	);
	markdownString.appendMarkdown(
		tasks
			.map(
				(task) =>
					`- \`${task.name}\`${task.description ? ` — ${task.description}` : ""}`,
			)
			.join("\n"),
	);
	return markdownString;
}

export class TaskHoverProvider implements vscode.HoverProvider {
	private miseService: MiseService;
	constructor(miseService: MiseService) {
		this.miseService = miseService;
	}

	/**
	 * Caching requires at least one source, so tasks without any can skip the
	 * `mise cache task` call entirely.
	 */
	private async getCacheState(
		task: MiseTask,
		document: vscode.TextDocument,
	): Promise<TaskCacheState> {
		if (!task.sources?.length) {
			return { entries: [] };
		}

		const entries = await this.miseService.getTaskCacheEntries(task.name);
		if (entries.length === 0) {
			return { entries };
		}

		// entries go stale whenever the task runs, watch them from now on
		this.miseService.ensureTaskCacheWatcher();

		return {
			entries,
			nextRunKey: (await this.canComputeCacheKey(task, document))
				? await this.miseService.getTaskCacheKey(task.name)
				: undefined,
		};
	}

	/**
	 * Computing the cache key of a task runs its `cache.command_inputs`, which
	 * a hover must never do. Only the tasks declared in the hovered document can
	 * be checked for them, so anything defined elsewhere is left alone.
	 */
	private async canComputeCacheKey(
		task: MiseTask,
		document: vscode.TextDocument,
	): Promise<boolean> {
		if (expandPath(task.source) !== expandPath(document.uri.fsPath)) {
			return false;
		}

		const parsed = getCachedTomlParser(document)?.parsed;
		if (!parsed) {
			return false;
		}

		const declarations = findTaskCacheDeclarations(parsed);
		return getTaskDefinitionNameCandidates(task.name).some((name) => {
			const declaration = declarations.get(name);
			return declaration?.enabled === true && !declaration.hasCommandInputs;
		});
	}

	public async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.Hover | null> {
		if (!isMiseExtensionEnabled()) {
			return null;
		}

		const tasks = await this.miseService.getAllCachedTasks();
		const documentPath = expandPath(document.uri.fsPath);
		const tasksSources = tasks.map((t) => expandPath(t.source));
		if (!tasksSources.includes(documentPath)) {
			return null;
		}

		const tomParser = getCachedTomlParser(document);
		if (!tomParser) {
			return null;
		}

		const keyAtPosition = tomParser.getKeyAtPosition(position);
		const keyPath = keyAtPosition?.key ?? [];
		if (!keyPath.length) {
			return null;
		}

		// `depends` under [tools.*] refers to other tools, not tasks
		if (keyPath[0] === "tools") {
			return null;
		}

		if (
			(keyPath.length === 1 && !isMiseTomlFile(document.fileName)) ||
			(keyPath.length === 2 && keyPath[0] === "tasks")
		) {
			const taskNameRange = document.getWordRangeAtPosition(
				position,
				TASK_NAME_REGEX,
			);
			if (!taskNameRange) {
				return null;
			}

			// the parsed key handles quoted names like `[tasks."docs:build"]`
			const localName = String(keyPath.at(-1));
			const task = resolveTaskReference(tasks, localName, documentPath);
			if (!task) {
				return null;
			}

			return new vscode.Hover(
				createMarkdownString(task, await this.getCacheState(task, document)),
				taskNameRange,
			);
		}

		if (!isDependsKeyword(keyPath.at(-1) || "")) {
			return null;
		}

		const patternRange = document.getWordRangeAtPosition(
			position,
			TASK_PATTERN_REGEX,
		);
		if (!patternRange) {
			return null;
		}

		const pattern = document.getText(patternRange);
		// `^task` refers to upstream projects, which requires the projects graph
		const projects = pattern.startsWith("^")
			? await this.miseService.getTasksGraph()
			: [];
		const matchingTasks = findTasksMatchingDependsPattern(
			tasks,
			pattern,
			documentPath,
			projects,
		);

		const [firstTask] = matchingTasks;
		if (!firstTask) {
			return null;
		}

		if (matchingTasks.length === 1) {
			return new vscode.Hover(
				createMarkdownString(
					firstTask,
					await this.getCacheState(firstTask, document),
				),
				patternRange,
			);
		}

		return new vscode.Hover(
			createTaskListMarkdownString(pattern, matchingTasks),
			patternRange,
		);
	}
}
