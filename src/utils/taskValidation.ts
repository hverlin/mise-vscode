import type { KeyPosition, SourcePosition } from "./miseFileParser";
import { getAllTaskNames } from "./taskNames";

/**
 * The task configuration keys an issue of `mise tasks validate` is about, and
 * the value it names when it quotes one. An empty `keys` points at the task.
 */
export type TaskIssueTarget = { keys: string[]; value?: string };

export type SourceRange = { start: SourcePosition; end: SourcePosition };

/** Keys of each category, and the message quoting the offending value */
const ISSUE_TARGETS: Record<string, { keys: string[]; valuePattern?: RegExp }> =
	{
		"missing-dependency": {
			keys: ["depends", "depends_post", "wait_for"],
			valuePattern: /^Dependency '(.+)' not found$/,
		},
		"missing-task-reference": {
			keys: ["run"],
			// a `run` entry, or a task of a `{ tasks = [...] }` group of `run`
			valuePattern:
				/^Task '(.+)' (?:referenced in run entry|in task group) not found$/,
		},
		"empty-script": { keys: ["run"] },
		"missing-daemon": {
			keys: ["daemons"],
			valuePattern: /^requires daemon '(.+)', which is not defined/,
		},
		"invalid-daemon-config": { keys: ["daemons"] },
		"invalid-glob-pattern": {
			keys: ["sources", "outputs"],
			valuePattern: /^Invalid (?:source|output) glob pattern: '(.+)'$/,
		},
		"invalid-timeout": {
			keys: ["timeout"],
			valuePattern: /^Invalid timeout format: '(.+)'$/,
		},
		"invalid-shell": { keys: ["shell"] },
		"missing-directory": { keys: ["dir"] },
		"invalid-directory-template": { keys: ["dir"] },
		"usage-parse-error": { keys: ["usage"] },
		"usage-directive": { keys: ["usage"] },
		secrets: { keys: ["secrets"] },
		"alias-conflict": {
			keys: ["alias"],
			valuePattern: /^Alias '(.+)' is used by multiple tasks$/,
		},
		"missing-file": { keys: ["file"] },
	};

export function getTaskIssueTarget(
	issue: MiseTaskValidationIssue,
): TaskIssueTarget {
	const target = ISSUE_TARGETS[issue.category];
	if (!target) {
		return { keys: [] };
	}
	const value = target.valuePattern?.exec(issue.message)?.[1];
	return value === undefined
		? { keys: target.keys }
		: { keys: target.keys, value };
}

/**
 * `task not found: <name>` of a dependency graph error, which suggests similar
 * task names on the lines below it in a monorepo
 */
function getGraphErrorTaskName(issue: MiseTaskValidationIssue) {
	return /^task not found: (.+)$/m.exec(issue.details?.trim() ?? "")?.[1];
}

/** Templates render when the task runs, `mise tasks validate` reads them as is */
const isTemplated = (value: string | undefined) => !!value?.includes("{{");

/**
 * The issues worth reporting. mise does not render templates before checking
 * them, so `depends = ["build {{usage.target}}"]` would be a missing task, and
 * a graph error repeats the missing dependency that caused it, on every task
 * depending on the one that declares it.
 */
export function filterTaskValidationIssues(
	issues: MiseTaskValidationIssue[],
): MiseTaskValidationIssue[] {
	const missingDependencies = new Set(
		issues
			.filter((issue) => issue.category === "missing-dependency")
			.map((issue) => getTaskIssueTarget(issue).value),
	);

	return issues.filter((issue) => {
		if (isTemplated(getTaskIssueTarget(issue).value)) {
			return false;
		}
		if (issue.category === "dependency-graph-error") {
			const name = getGraphErrorTaskName(issue);
			return !(
				name !== undefined &&
				(isTemplated(name) || missingDependencies.has(name))
			);
		}
		return true;
	});
}

/**
 * Message of the diagnostic: what is wrong, then mise's explanation. A usage
 * spec error draws a box around the spec, only its `× <reason>` line is kept.
 */
export function formatTaskIssueMessage(issue: MiseTaskValidationIssue): string {
	const details = issue.details?.trim();
	const reason = details?.match(/×\s*(.+)/)?.[1]?.trim() ?? details;
	return reason ? `${issue.message}\n${reason}` : issue.message;
}

/**
 * The task an issue is about. mise reports the name of the task, which an alias
 * of another task may shadow.
 */
export function findValidatedTask(
	tasks: MiseTask[],
	name: string,
): MiseTask | undefined {
	return (
		tasks.find((task) => task.name === name) ??
		// the qualified alias of a monorepo script task
		tasks.find((task) => getAllTaskNames(task).includes(name))
	);
}

const sameKey = (key: string[], expected: string[]) =>
	key.length === expected.length &&
	key.every((part, index) => part === expected[index]);

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Range of `value` in `"value"` or `'value'` between two positions, also when
 * arguments follow it, as in `depends = ["lint --fix"]`
 */
function findQuotedValue(
	lines: string[],
	{ start, end }: SourceRange,
	value: string,
): SourceRange | undefined {
	const quoted = new RegExp(
		`(["'])${escapeRegExp(value)}(?:\\s[^"']*)?\\1`,
		"g",
	);
	for (let line = start.line; line <= end.line; line++) {
		const text = lines[line] ?? "";
		quoted.lastIndex = line === start.line ? start.character : 0;
		const to = line === end.line ? end.character : text.length;
		const match = quoted.exec(text);
		if (match && match.index + match[0].length <= to) {
			return {
				start: { line, character: match.index + 1 },
				end: { line, character: match.index + 1 + value.length },
			};
		}
	}
	return undefined;
}

/**
 * Where an issue goes in a TOML config file: the value it quotes, else the key
 * it is about, else the name of the task. `taskKeys` are the key paths the task
 * may be declared under, e.g. `["tasks", "build"]`, or `["build"]` in a task
 * include file. Undefined when the task is not declared in the file.
 */
export function findTomlTaskIssueRange(
	positions: KeyPosition[],
	lines: string[],
	taskKeys: string[][],
	target: TaskIssueTarget,
): SourceRange | undefined {
	for (const taskKey of taskKeys) {
		const task = positions.find((position) => sameKey(position.key, taskKey));
		if (!task) {
			continue;
		}

		const fields = target.keys.flatMap((key) =>
			positions.filter((position) => sameKey(position.key, [...taskKey, key])),
		);
		// a dependency may be in `depends_post` of a task that has `depends`
		if (target.value !== undefined) {
			for (const field of fields) {
				const valueRange = findQuotedValue(
					lines,
					{ start: field.valueStart, end: field.valueEnd },
					target.value,
				);
				if (valueRange) {
					return valueRange;
				}
			}
		}

		const [field] = fields;
		// keys set by a template or `[monorepo.task_defaults]` are not in the file
		return field
			? { start: field.keyStart, end: field.keyEnd }
			: { start: task.keyStart, end: task.keyEnd };
	}
	return undefined;
}

const fileTaskHeaderLine = (directive: "MISE" | "USAGE", key = "") =>
	new RegExp(
		`^\\s*(?:#|//|--)\\s*(?:\\[${directive}\\]|${directive})\\s+${key}`,
	);

/**
 * Line of a file task an issue goes on: the `#USAGE` lines for usage errors,
 * the `#MISE <key>=` line of the key it is about, else the first line.
 */
export function findFileTaskIssueLine(
	lines: string[],
	target: TaskIssueTarget,
): number {
	const patterns = target.keys.map((key) =>
		key === "usage"
			? fileTaskHeaderLine("USAGE")
			: fileTaskHeaderLine("MISE", `${key}\\s*=`),
	);
	const line = lines.findIndex((text) =>
		patterns.some((pattern) => pattern.test(text)),
	);
	return line === -1 ? 0 : line;
}
