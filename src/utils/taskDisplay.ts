// This module is bundled into the webviews, it must stay free of node imports.

import { markdownCodeSpan } from "./markdown";

/**
 * One line per `run` entry: shell commands as written, and the table entries
 * as the tasks they reference, mirroring the keys of the config
 * (`task: build --release`, `tasks: lint, test`).
 */
export function formatRunEntries(run: MiseTask["run"]): string[] {
	return (run ?? []).map((entry) => {
		if (typeof entry === "string") {
			return entry;
		}
		if (entry.tasks?.length) {
			return `tasks: ${entry.tasks.join(", ")}`;
		}
		if (entry.task) {
			return `task: ${[entry.task, ...(entry.args ?? [])].join(" ")}`;
		}
		return "";
	});
}

/** Secondary line of a task, falling back to its command when undocumented. */
export function getTaskDescription(task: MiseTask): string {
	return task.description || formatRunEntries(task.run).join(" ") || "";
}

/**
 * Markdown lines for what a task gets before it starts: the project daemons it
 * waits for, the secrets it receives (both experimental) and its timeout.
 */
export function formatTaskRunRequirements(task: MiseTask): string[] {
	const lines: string[] = [];
	const codeList = (values: string[]) =>
		values.map(markdownCodeSpan).join(", ");

	if (task.daemons === true) {
		lines.push("Daemons: every project daemon");
	} else if (Array.isArray(task.daemons) && task.daemons.length) {
		lines.push(`Daemons: ${codeList(task.daemons)}`);
	}
	if (task.secrets?.length) {
		lines.push(`Secrets: ${codeList(task.secrets)}`);
	}
	if (task.timeout) {
		lines.push(`Timeout: ${markdownCodeSpan(task.timeout)}`);
	}
	return lines;
}

/** Display a mise task outputs field from `mise tasks ls --json`. */
export function formatTaskOutputs(
	outputs: MiseTask["outputs"],
): string | undefined {
	if (Array.isArray(outputs)) {
		return outputs.join(", ");
	}
	return outputs?.auto ? "Auto-detected" : undefined;
}
