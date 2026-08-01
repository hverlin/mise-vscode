import micromatch from "micromatch";
import { expandPath } from "./fileUtils";

// https://mise.jdx.dev/tasks/monorepo.html
// Mise reports monorepo tasks as `//path:task` while config files keep local
// names (`build`). Workspace script tasks are named `node:pkg#script` with the
// qualified form as alias; toml task aliases stay unqualified (`fmt`).
// All helpers are transparent for non-monorepo tasks.
export const MONOREPO_TASK_PREFIX = "//";

const MICROMATCH_OPTIONS = {
	dot: true,
	nobrace: false, // Enable {a,b} matching
	noglobstar: false, // Enable ** matching
};

/**
 * "." is deliberately excluded: it would make `[tasks.build]` headers resolve
 * to `tasks.build` instead of `build`.
 */
export const TASK_NAME_REGEX = /[\w/:-]+/;

/**
 * Wider than TASK_NAME_REGEX to capture wildcards (`//projects/...:build`,
 * `:test*`). Only safe inside depends values, where quotes delimit the entry.
 */
export const TASK_PATTERN_REGEX = /[\w/:.*?{},-]+/;

export type TaskNameParts = {
	/**
	 * Config root path relative to the monorepo root ("" for tasks defined at
	 * the monorepo root itself). `null` for non-monorepo tasks.
	 */
	configRoot: string | null;
	/** Task name without the monorepo qualifier */
	localName: string;
};

export function isMonorepoTaskName(name: string) {
	return name.startsWith(MONOREPO_TASK_PREFIX);
}

export function getTaskNameParts(name: string): TaskNameParts {
	if (!isMonorepoTaskName(name)) {
		return { configRoot: null, localName: name };
	}

	// local task names may contain ":" (e.g. `//:docs:build`), the config root
	// path cannot, so split on the first ":"
	const separatorIndex = name.indexOf(":");
	if (separatorIndex === -1) {
		return { configRoot: name.slice(2), localName: "" };
	}

	return {
		configRoot: name.slice(2, separatorIndex),
		localName: name.slice(separatorIndex + 1),
	};
}

export function getLocalTaskName(name: string) {
	return getTaskNameParts(name).localName;
}

/** `node:frontend#test` -> `test`, undefined for other task names */
function getProviderScriptName(name: string): string | undefined {
	if (isMonorepoTaskName(name)) {
		return undefined;
	}
	const hashIndex = name.indexOf("#");
	if (hashIndex === -1) {
		return undefined;
	}
	return name.slice(hashIndex + 1) || undefined;
}

export function getAllTaskNames(task: MiseTask): string[] {
	return [task.name, ...(task.aliases ?? [])];
}

/**
 * Aliases are considered too: workspace script tasks only carry their config
 * root in their qualified alias. `null` for non-monorepo tasks.
 */
export function getTaskConfigRoot(task: MiseTask): string | null {
	for (const name of getAllTaskNames(task)) {
		const { configRoot } = getTaskNameParts(name);
		if (configRoot !== null) {
			return configRoot;
		}
	}
	return null;
}

/** All the names a task can be referred to with inside its own config root */
export function getTaskLocalNames(task: MiseTask): string[] {
	const localNames = new Set<string>();
	for (const name of getAllTaskNames(task)) {
		if (isMonorepoTaskName(name)) {
			localNames.add(getLocalTaskName(name));
			continue;
		}
		const scriptName = getProviderScriptName(name);
		if (scriptName) {
			localNames.add(scriptName);
		} else {
			localNames.add(name);
		}
	}
	return [...localNames];
}

/** Local name for contexts that already show the source file or project */
export function getTaskDisplayName(task: MiseTask): string {
	const qualifiedName = getAllTaskNames(task).find(isMonorepoTaskName);
	if (qualifiedName) {
		return getLocalTaskName(qualifiedName);
	}
	return task.name;
}

/** Keys to look for in the source file (toml task key or package.json script) */
export function getTaskDefinitionNameCandidates(taskName: string): string[] {
	const candidates = new Set<string>();
	const scriptName = getProviderScriptName(taskName);
	if (scriptName) {
		candidates.add(scriptName);
	}
	candidates.add(getLocalTaskName(taskName));
	return [...candidates];
}

/** Workspace-relative config roots, excluding the monorepo root itself */
export function getConfigRootPaths(tasks: MiseTask[]): string[] {
	const configRoots = new Set<string>();
	for (const task of tasks) {
		const configRoot = getTaskConfigRoot(task);
		if (configRoot) {
			configRoots.add(configRoot);
		}
	}
	return [...configRoots].sort();
}

function getTasksForSource(tasks: MiseTask[], documentPath: string) {
	return tasks.filter((t) => expandPath(t.source) === documentPath);
}

function getConfigRootForSource(tasks: MiseTask[], documentPath: string) {
	const [firstTask] = getTasksForSource(tasks, documentPath);
	return firstTask ? getTaskConfigRoot(firstTask) : null;
}

/**
 * Fully qualified name to run for a task name that appears in the given
 * document. Falls back to the given name so that non-monorepo setups keep
 * working even with stale task lists.
 */
export function qualifyTaskName(
	tasks: MiseTask[],
	localName: string,
	documentPath: string,
): string {
	const task = getTasksForSource(tasks, documentPath).find((t) =>
		getTaskLocalNames(t).includes(localName),
	);
	return task?.name ?? localName;
}

/**
 * Resolve a task reference (https://mise.jdx.dev/tasks/monorepo.html#running-tasks):
 * - `//path/to/project:task` - fully qualified name or alias
 * - `:task` - task in the same config root as the referencing file
 * - `task` - same file first, then same config root, then exact name or alias
 */
export function resolveTaskReference(
	tasks: MiseTask[],
	word: string,
	documentPath?: string,
): MiseTask | undefined {
	if (isMonorepoTaskName(word)) {
		const { configRoot, localName } = getTaskNameParts(word);
		return tasks.find(
			(t) =>
				getAllTaskNames(t).includes(word) ||
				(getTaskConfigRoot(t) === configRoot &&
					getTaskLocalNames(t).includes(localName)),
		);
	}

	const documentTasks = documentPath
		? getTasksForSource(tasks, documentPath)
		: [];
	const configRoot = documentPath
		? getConfigRootForSource(tasks, documentPath)
		: null;

	if (word.startsWith(":")) {
		if (configRoot === null) {
			return undefined;
		}
		const localName = word.slice(1);
		return tasks.find(
			(t) =>
				getTaskConfigRoot(t) === configRoot &&
				getTaskLocalNames(t).includes(localName),
		);
	}

	const sameSourceTask = documentTasks.find((t) =>
		getTaskLocalNames(t).includes(word),
	);
	if (sameSourceTask) {
		return sameSourceTask;
	}

	if (configRoot !== null) {
		const sameRootTask = tasks.find(
			(t) =>
				getTaskConfigRoot(t) === configRoot &&
				getTaskLocalNames(t).includes(word),
		);
		if (sameRootTask) {
			return sameRootTask;
		}
	}

	return tasks.find((t) => getAllTaskNames(t).includes(word));
}

/** Tasks a depends entry refers to (several for wildcard patterns) */
export function findTasksMatchingDependsPattern(
	tasks: MiseTask[],
	pattern: string,
	documentPath?: string,
): MiseTask[] {
	const ownerConfigRoot = documentPath
		? getConfigRootForSource(tasks, documentPath)
		: null;
	return tasks.filter((t) =>
		dependsPatternMatchesTask(pattern, ownerConfigRoot, t),
	);
}

/**
 * Wildcards (https://mise.jdx.dev/tasks/monorepo.html):
 * - `...` matches any number of path segments (`//projects/...:build`)
 * - `*` matches within task names (`:test*`, `//projects/frontend:*`)
 */
export function dependsPatternMatchesTask(
	pattern: string,
	ownerConfigRoot: string | null,
	target: MiseTask,
): boolean {
	// depends entries may carry arguments: `depends = ["build --quick"]`
	const [taskPattern] = pattern.split(/\s+/);
	if (!taskPattern) {
		return false;
	}

	const targetConfigRoot = getTaskConfigRoot(target);
	const targetLocalNames = getTaskLocalNames(target);
	const matchesLocalName = (namePattern: string) =>
		targetLocalNames.some((localName) =>
			micromatch.isMatch(localName, namePattern, MICROMATCH_OPTIONS),
		);

	if (isMonorepoTaskName(taskPattern)) {
		if (targetConfigRoot === null) {
			return false;
		}
		const separatorIndex = taskPattern.indexOf(":");
		if (separatorIndex === -1) {
			return false;
		}
		const pathPattern = taskPattern.slice(2, separatorIndex);
		const namePattern = taskPattern.slice(separatorIndex + 1);
		const pathMatches =
			pathPattern === "..."
				? true
				: pathPattern === targetConfigRoot ||
					micromatch.isMatch(
						targetConfigRoot,
						pathPattern.replaceAll("...", "**"),
						MICROMATCH_OPTIONS,
					);
		return pathMatches && matchesLocalName(namePattern);
	}

	if (taskPattern.startsWith(":")) {
		return (
			ownerConfigRoot !== null &&
			targetConfigRoot === ownerConfigRoot &&
			matchesLocalName(taskPattern.slice(1))
		);
	}

	if (ownerConfigRoot !== null) {
		// bare names inside a monorepo refer to tasks in the same config root
		return (
			targetConfigRoot === ownerConfigRoot && matchesLocalName(taskPattern)
		);
	}

	return getAllTaskNames(target).some((name) =>
		micromatch.isMatch(name, taskPattern, MICROMATCH_OPTIONS),
	);
}
