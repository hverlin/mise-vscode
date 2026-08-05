// This module is bundled into the webviews, it must stay free of node imports.

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

/** Display a mise task outputs field from `mise tasks ls --json`. */
export function formatTaskOutputs(
	outputs: MiseTask["outputs"],
): string | undefined {
	if (Array.isArray(outputs)) {
		return outputs.join(", ");
	}
	return outputs?.auto ? "Auto-detected" : undefined;
}
